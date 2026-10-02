# Ripple engine: accuracy experiments

Hand-written log of ideas tried to make the what-if engine more accurate, with their out-of-sample results. Each was
scored with the backtest (`npm run backtest`, method in `research/backtest.md`): 31 quarters (2019Q1–2026Q3), links
re-estimated at each quarter with only earlier data, the same fixed yardstick for every variant. "Skill" = average over
the four features of 1 − squared error ÷ that of "no change from trend" (higher is better). A change is kept only if it
improves skill and holds in both halves of the period (2019Q1–2022Q4, 2023Q1–2026Q3).

## Kept

| Change | Skill | Halves | Notes |
|---|---|---|---|
| Estimated links instead of hand-set | 0.095 → 0.106 | better in both | October 2026, first backtest. |
| Priors at half width (estimates stay closer to the economic reasoning) | 0.102 → 0.106 | better in both | ×0.25 0.105, ×0.75 0.104, ×1 0.102, ×2 0.090: a genuine optimum. |
| Effects of effects (2 rounds) | 0.098 → 0.106 | better in both | 3 rounds 0.097. |
| A fade per feature | 0.080 → 0.106 (with the above) | better in both | Valuations 0.85, deal counts 1 (persist), IPO counts 0.55. Cross-validated: fades tuned on one half still beat the untuned settings on the other. |
| Scoring: take the calendar pattern out of deal and IPO outcomes | 0.106 → 0.108 (same engine) | — | Not an engine change: a fairer yardstick. Deals dip ~21% in Q1, IPOs bunch ~43% in Q2; a predictable seasonal swing shouldn't count as a miss. Seasonal levels are measured only from quarters before each forecast. |

## Tried and rejected

| Idea | Skill (vs 0.108) | Why it was dropped |
|---|---|---|
| Quarter-of-year controls in the estimation | 0.106 | Three more parameters cost more than they gain in the short early training windows. Switch: `SEASONAL` in `research/estimate_links.py`. |
| Magnitude calibration per feature (scale every knock-on effect, tuned with the fades) | 0.115 in sample | Cross-validation failed: tuned on one half it made the other half worse (0.063 → 0.055 and 0.134 → 0.118), and the halves disagreed on the gains (deal counts ×2 vs ×0.5). It was fitting the 2020 quarters. |
| Separate prior widths for feature / sector / macro links (11 combinations) | 0.106–0.108 | No gain: looser macro priors help IPOs slightly (0.053 vs 0.047) but cost valuations the same. Labels like `f0.25/s0.5/m1` stay in the search. |
| Deal values capped at $5B per deal for the estimation (scored on real totals) | 0.108 | No change: the deal-value links are ~97% prior (the data is too noisy to move them), so the input barely matters. Switch: `DEAL_VALUE`. |
| Stronger clipping of deal and IPO growth (5th / 95th instead of 2.5th / 97.5th) | 0.107 | No gain. |
| The six sector spillovers the estimation suggested (Industrials → Tech, …), with reasons | 0.105 | Worse in both halves, mainly valuations (0.313 vs 0.327): they capture sectors moving together in the same quarter, which doesn't help predict later quarters. |
| Macro changes between quarter-end months instead of quarter averages | 0.106 | Worse in recent years (0.044 vs 0.061). Switch: `MACRO_TIMING`. |
| Leaving the pandemic quarters (2020Q1–Q3) out of the estimation | 0.106 | No gain; with end-of-quarter macro too, 0.104. Switch: `EXCLUDE_QUARTERS`. |

## What limits accuracy now

- **The data, not the tuning.** Every variant lands at 0.104–0.108. Across all four regressions only four coefficients
  clear |t| > 2, and three are same-quarter co-movement between flows (the "open window" effect), which can't help a
  forecast.
- **Deal values** are a coin flip at the sector-quarter level: the biggest 3% of deals carry a quarter of all value, so
  one megadeal makes or breaks a quarter.
- **Thin deal history**: 2019–2020 and nine earlier sector-years fail the coverage check, so deal links learn from
  2015–2018 and 2021 onward only.

## Ideas not yet tried

- Better 2019–2020 deal coverage (the history backfill finds ~30% of merger-proxy filers vs 35–57% live): more quarters
  to learn from and to score.
- Longer lags (3–4 quarters) for deal counts, whose misses grow with the horizon; needs lag-3 links in the engine.
