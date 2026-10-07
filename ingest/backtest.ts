/**
 * Backtest the ripple engine and pick the settings that predict best (npm run backtest).
 *
 * research/backtest.py re-estimates the links at every quarter from 2019 using only earlier data. This feeds the engine
 * each quarter's real macro changes and ETF moves and scores its next four quarters against what happened
 * (lib/ripple/backtest.ts). It searches:
 *   - links: hand-set, or estimated with the priors at half, normal or double width;
 *   - effects of effects: 1, 2 or 3 rounds;
 *   - fade per quarter, chosen per feature (prices may persist while deal bursts die out).
 * The winner is the setup with the best average skill over the four features. Writes lib/ripple/tuned.json (the chosen
 * settings, read by settings.ts), lib/ripple/backtest.json (the Accuracy page's numbers; the estimator reads its prior
 * width) and research/backtest.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { HISTORY_DIR } from "./historyStore";
import { backtest, featureScore, HORIZON, pool, priorWords, summarize, type ForecastPoint, type PanelRow, type Scores, type TunedSettings } from "../lib/ripple/backtest";
import { DEFAULT_LINKS, type Fade, type Links } from "../lib/ripple/engine";
import { applyEstimates, type EstimatesFile } from "../lib/ripple/estimated";
import { FEATURES, type Feature } from "../lib/ripple/links";

const LAMBDAS = [0.4, 0.55, 0.7, 0.85, 1];
const ROUNDS = [1, 2, 3];
// Earlier quarters' shocks fed in (their effects are still rippling at the forecast date). Up to the engine's longest
// link lag: going further back (3–6, October 2026) only fitted 2019–2020 and lowered the direction rate.
const HISTORIES = [0, 1, 2];
const OUT_JSON = "lib/ripple/backtest.json";
const OUT_TUNED = "lib/ripple/tuned.json";
const OUT_REPORT = "research/backtest.md";

interface Input {
  origins: string[];
  ipoHistory: boolean;
  panel: PanelRow[];
  estimates: Record<string, Record<string, EstimatesFile>>;
}

type LinkSetName = "hand-set" | "estimated";
interface Setup {
  linkSet: LinkSetName;
  /** Prior width label for estimated links ("0.5", or "f0.25/s0.5/m1" per link kind); null for hand-set. */
  priorScale: string | null;
  rounds: number;
  lambda: Fade;
  /** Quarters of earlier shocks fed in at each forecast. */
  history: number;
}

const qiOf = (label: string) => Number(label.slice(0, 4)) * 4 + Number(label.slice(5)) - 1;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0;
const uniform = (l: number) => Object.fromEntries(FEATURES.map((f) => [f, l])) as Fade;
const label = (s: Setup) =>
  `${s.linkSet === "hand-set" ? "hand-set" : `estimated (${priorWords(s.priorScale)})`}, ${s.rounds === 1 ? "direct effects" : `${s.rounds} rounds`}, fade ${FEATURES.map((f) => s.lambda[f]).join("/")}, ${historyWords(s.history)}`;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function main() {
  // --input another inputs file (an experiment from research/backtest.py --out); --dry prints without writing.
  const dry = process.argv.includes("--dry");
  const input = JSON.parse(readFileSync(arg("input") ?? `${HISTORY_DIR}/backtest_input.json`, "utf8")) as Input;
  const origins = input.origins.map(qiOf);
  const labelOf = new Map(input.origins.map((l) => [qiOf(l), l]));
  const cache = new Map<string, Links>();
  const linksFor = (set: LinkSetName, scale: string | null) => (t: number): Links => {
    if (set === "hand-set") return DEFAULT_LINKS;
    const id = `${scale}|${t}`;
    if (!cache.has(id)) cache.set(id, applyEstimates(DEFAULT_LINKS, input.estimates[scale!][labelOf.get(t)!]));
    return cache.get(id)!;
  };
  const run = (s: Setup, subset = origins) => backtest(input.panel, subset, linksFor(s.linkSet, s.priorScale), { lambda: s.lambda, rounds: s.rounds, history: s.history });
  const score = (scores: Scores) => mean(FEATURES.map((f) => featureScore(scores, f)));

  // Search. A feature's prediction depends only on its own fade, so each fade is chosen on its own.
  const candidates: { setup: Setup; score: number; perFeature: Record<Feature, number> }[] = [];
  const sets: [LinkSetName, string | null][] = [["hand-set", null], ...Object.keys(input.estimates).map((s) => ["estimated", s] as [LinkSetName, string])];
  for (const history of HISTORIES) {
    for (const [linkSet, priorScale] of sets) {
      for (const rounds of ROUNDS) {
        const byLambda = LAMBDAS.map((l) => run({ linkSet, priorScale, rounds, lambda: uniform(l), history }).scores);
        const lambda = {} as Fade;
        const perFeature = {} as Record<Feature, number>;
        for (const f of FEATURES) {
          const best = LAMBDAS.map((l, i) => ({ l, s: featureScore(byLambda[i], f) })).sort((a, b) => b.s - a.s || b.l - a.l)[0];
          lambda[f] = best.l;
          perFeature[f] = r3(best.s);
        }
        candidates.push({ setup: { linkSet, priorScale, rounds, lambda, history }, score: r3(mean(FEATURES.map((f) => perFeature[f]))), perFeature });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.setup.rounds - b.setup.rounds || a.setup.history - b.setup.history);
  // Tried and rejected (October 2026): a per-feature magnitude calibration tuned with the fades. It raised the score on
  // the full period but, tuned on one half, it made the other half worse in both directions (fitting noise).
  const chosen = candidates[0].setup;
  const previous: Setup = { linkSet: "estimated", priorScale: "1", rounds: 1, lambda: uniform(0.7), history: 0 };
  const handSet: Setup = { linkSet: "hand-set", priorScale: null, rounds: 1, lambda: uniform(0.7), history: 0 };
  // The best setup that sees only the forecast quarter's shocks: what feeding the earlier ones adds.
  const thisQuarter = candidates.find((c) => c.setup.history === 0)!.setup;
  const noLinks = backtest(input.panel, origins, () => ({ features: [], sectors: [], macro: [] }), { lambda: chosen.lambda, history: chosen.history });

  const final = run(chosen);
  const single = run(thisQuarter);
  const before = run(previous);
  const hand = run(handSet);
  const flows = (s: Scores) => summarize(pool((["dealCount", "dealValue", "ipoCount"] as Feature[]).flatMap((f) => s[f])));
  const allOf = (s: Scores) => summarize(pool(FEATURES.flatMap((f) => s[f])));

  // Does the choice hold up in both halves of the period?
  const mid = Math.ceil(origins.length / 2);
  const halves = [origins.slice(0, mid), origins.slice(mid)].map((subset) => ({
    from: labelOf.get(subset[0])!,
    to: labelOf.get(subset[subset.length - 1])!,
    chosen: r3(score(run(chosen, subset).scores)),
    previous: r3(score(run(previous, subset).scores)),
    handSet: r3(score(run(handSet, subset).scores)),
  }));

  const featureTable = Object.fromEntries(
    FEATURES.map((f) => [f, final.scores[f].map((c, i) => ({ k: i + 1, ...summarize(c) }))]),
  ) as Record<Feature, ({ k: number } & ReturnType<typeof summarize>)[]>;
  const out = {
    generatedAt: new Date().toISOString().slice(0, 19) + "Z",
    origins: { from: input.origins[0], to: input.origins[input.origins.length - 1], count: origins.length },
    ipoHistory: input.ipoHistory,
    horizon: HORIZON,
    chosen: { ...chosen, label: label(chosen) },
    summary: {
      chosen: { score: r3(score(final.scores)), all: allOf(final.scores), flows: flows(final.scores), valuation: summarize(pool(final.scores.valuation)) },
      previous: { label: label(previous), score: r3(score(before.scores)), all: allOf(before.scores), flows: flows(before.scores) },
      handSet: { label: label(handSet), score: r3(score(hand.scores)), all: allOf(hand.scores), flows: flows(hand.scores) },
      thisQuarterOnly: { label: label(thisQuarter), score: r3(score(single.scores)), all: allOf(single.scores), flows: flows(single.scores) },
      noLinks: { score: r3(score(noLinks.scores)), flows: flows(noLinks.scores) },
    },
    features: featureTable,
    halves,
    candidates: candidates.map((c) => ({ label: label(c.setup), ...c.setup, score: c.score, perFeature: c.perFeature })),
    points: final.points satisfies ForecastPoint[],
  };
  console.log(`backtest: ${origins.length} quarters (${out.origins.from}–${out.origins.to}), ${candidates.length} setups`);
  console.log(`  chosen:   ${out.chosen.label} → skill ${out.summary.chosen.score}, direction ${pct(out.summary.chosen.all.hitRate)}`);
  console.log(`  per feature: ${FEATURES.map((f) => `${f} ${candidates[0].perFeature[f]}`).join(", ")}`);
  console.log(`  previous: ${out.summary.previous.label} → skill ${out.summary.previous.score}, direction ${pct(out.summary.previous.all.hitRate)}`);
  console.log(`  this quarter's shocks only: ${out.summary.thisQuarterOnly.label} → skill ${out.summary.thisQuarterOnly.score}, direction ${pct(out.summary.thisQuarterOnly.all.hitRate)}`);
  console.log(`  halves: ${halves.map((h) => `${h.from}–${h.to}: chosen ${h.chosen} vs previous ${h.previous}`).join("; ")}`);
  if (dry) return;
  writeFileSync(OUT_JSON, JSON.stringify(out, null, 1) + "\n");
  // The engine reads only the chosen settings (a small file, so the scenario screen doesn't ship the whole backtest).
  const tunedOut: TunedSettings = {
    generatedAt: out.generatedAt,
    ...chosen,
    score: out.summary.chosen.score,
    previousScore: out.summary.previous.score,
    hitRate: out.summary.chosen.all.hitRate,
    quarters: origins.length,
    window: { from: out.origins.from, to: out.origins.to },
  };
  writeFileSync(OUT_TUNED, JSON.stringify(tunedOut, null, 1) + "\n");
  writeFileSync(OUT_REPORT, report(out));
  console.log(`wrote ${OUT_JSON}, ${OUT_TUNED} and ${OUT_REPORT}`);
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const historyWords = (h: number) => (h === 0 ? "this quarter's shocks" : `plus the last ${h === 1 ? "quarter's" : `${h} quarters'`} shocks`);
const sk = (v: number | null) => (v == null ? "—" : v.toFixed(3));
const NAMES: Record<Feature, string> = { valuation: "Valuation", dealCount: "Deal count", dealValue: "Deal value", ipoCount: "IPO count" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function report(o: any): string {
  const lines = [
    "# Ripple engine backtest",
    "",
    `Generated ${o.generatedAt} by \`ingest/backtest.ts\` (\`npm run backtest\`). Do not edit by hand.`,
    "",
    "## How it works",
    "",
    `At each of ${o.origins.count} quarters (${o.origins.from} to ${o.origins.to}) the links are re-estimated using only earlier data. The engine gets that quarter's real macro changes and sector ETF moves (less the part it already puts down to the macro changes)${o.chosen.history ? `, and those of the ${o.chosen.history === 1 ? "quarter" : `${o.chosen.history} quarters`} before (their effects are still rippling through the lagged links; only their part still to come counts)` : ""}, and predicts the next ${o.horizon} quarters.`,
    "",
    `Feeding the earlier quarters' shocks: direction ${pct(o.summary.thisQuarterOnly.all.hitRate)} → ${pct(o.summary.chosen.all.hitRate)}, skill ${o.summary.thisQuarterOnly.score} → ${o.summary.chosen.score} (best setup with this quarter's shocks only: ${o.summary.thisQuarterOnly.label}).`,
    "",
    `Deal and IPO outcomes are measured against the average of the four quarters before (plus trend), with the calendar pattern taken out (deals dip in Q1, IPOs bunch in Q2; measured from earlier quarters only); valuations against the quarter before. Ideas tried to improve on this, kept or rejected, are in \`research/experiments.md\`.`,
    "",
    '- **Skill**: 1 − squared error ÷ squared error of predicting "no change from trend". Above 0 beats it; 1 would be perfect.',
    "- **Direction**: share of predicted moves (0.5 points or more) with the right sign. A coin flip scores 50%.",
    "- **Slope**: what happened regressed on what was predicted. 1 = effects sized right; below 1 = overstated.",
    "",
    "## Chosen settings",
    "",
    `**${o.chosen.label}**. Average skill ${o.summary.chosen.score} (previous settings ${o.summary.previous.score}, hand-set links ${o.summary.handSet.score}, no links ${o.summary.noLinks.score}). Direction right ${pct(o.summary.chosen.all.hitRate)} of the time overall, ${pct(o.summary.chosen.flows.hitRate)} for deals and IPOs.`,
    "",
    "| Period | Chosen | Previous | Hand-set |",
    "|---|---|---|---|",
    ...o.halves.map((h: { from: string; to: string; chosen: number; previous: number; handSet: number }) => `| ${h.from}–${h.to} | ${h.chosen} | ${h.previous} | ${h.handSet} |`),
    "",
    "## By feature and quarter ahead (chosen settings)",
    "",
    "| Feature | Q | n | Skill | Direction | Slope |",
    "|---|---|---|---|---|---|",
  ];
  for (const f of FEATURES) for (const c of o.features[f]) if (c.n) lines.push(`| ${NAMES[f]} | Q${c.k} | ${c.n} | ${sk(c.skill)} | ${pct(c.hitRate)} | ${c.slope ?? "—"} |`);
  lines.push("", "## Every setup tried", "", "Fade per feature: valuation / deal count / deal value / IPO count.", "", "| Setup | Score | Valuation | Deal count | Deal value | IPO count |", "|---|---|---|---|---|---|");
  for (const c of o.candidates) lines.push(`| ${c.label} | ${c.score} | ${FEATURES.map((f) => c.perFeature[f]).join(" | ")} |`);
  lines.push(
    "",
    "## Caveats",
    "",
    "- Settings chosen on the same quarters they are scored on flatter them a little; the two halves show whether the choice holds.",
    "- Deal figures in weak sector-years (2019–2020 and a few earlier) can't be scored, so deal results lean on 2021 onward.",
    "- Quarterly deal and IPO counts are noisy: most of their movement is not explained by macro or market moves, so skill stays small even when the direction is right.",
    "",
  );
  return lines.join("\n");
}

main();
