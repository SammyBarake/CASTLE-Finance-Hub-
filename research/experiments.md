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
| Better data: history and live deal coverage | 0.108 → 0.119 | better in both (0.153 / 0.061 vs untuned 0.105 / 0.059) | Not a model change. Older filings' `&#147;`-style entities hid defined terms, the backstop judged "listed" by today's tickers, press headlines were read from sub-headlines, and all-stock deals matched no search phrase. Fixed, the 2015–2020 history was re-read (public-target deals +52–98% a year) and the live 2021+ deals rebuilt (1,988 → 2,537). Recall 31–44% → 52–66%; 2019 no longer weak (2020 still is). The search now prefers per-kind priors (feature ×0.5, spillovers ×1, macro ×0.5) and 3 rounds: with fuller deal data the spillovers carry more signal. 14 of 38 links data-driven (was 8). The yardstick's data changed too, so the gain isn't a pure like-for-like comparison. |
| Feed the last two quarters' shocks (`history` in `lib/ripple/backtest.ts`) | direction 60% → 65%; skill 0.119 → 0.164 | direction 64% / 57% → 69% / 62%; skill 0.153 → 0.240 and 0.061 → 0.058 | October 2026, the round aimed at "% correct". Each forecast saw only that quarter's moves, though the engine's lagged links say the previous two quarters' moves are still rippling. Their part still to come now counts (measured from the same baseline as the outcome). Every flow improves: deal values 52% → 61%, IPOs 57% → 64%, deal counts 60% → 63%. One quarter back 63%, two 65%; three to six raise early-half skill but lower direction (fitting 2019–2020), so the search stops at the engine's longest lag. With it the fades become 1 / 1 / 1 / 0.55 and the priors ×0.25 / ×0.5 / ×0.5 (the prior width landscape is flat: 64–65% for every width). |

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

Tried with two quarters of history (October 2026; direction vs 65.3%, harness `.scratch/bt-exp.mts`):

| Idea | Direction | Why it was dropped |
|---|---|---|
| Also feed the earlier quarters' deal and IPO surprises (`flowHistory`) | 58.8–60.6% | Much worse, later half 54–57%: quarterly deal and IPO growth is mostly noise, and the links spread it. |
| Three to six quarters of history | 63–65% | Early-half skill up, direction and later half down: fitting 2019–2020. |
| Sector-specific valuation → deal / IPO links where an F-test supports them (`SECTOR_FEATURES`, engine `bySector`) | 65.3% (no change) | The F-test rarely rejects a common value, and raw per-sector slopes are all |t| < 1 on 47 quarters (Healthcare deal counts lean negative, t −0.7): no reliable sector difference to learn. The engine support stays (tested), the switch off. |
| Recency weighting of the estimation, half-life 2 / 4 / 8 years (`HALF_LIFE`) | 65.2–65.3% | No change: the priors dominate those equations. |
| 4–6 rounds of effects | 65.2% at 4 | No gain; beyond that the chains explode. `MAX_ROUNDS` stays 3. |
| ETF moves not net of the macro-explained part | 62.5% | Worse: counts the macro effects twice. |
| Fades chosen by direction instead of skill | 65.3% | Picks the same fades. |
| Macro changes at quarter-end months | 64.3% | Worse, again. |
| Input ETF moves against a common trend / no trend (yardstick unchanged) | 64.6% / 62.8% | Worse: a sector's own trend is the right "expected" move. |
| Capping input ETF moves at ±10 / 15 / 20 points | 64.7–65.1% | No gain. |
| Averaging the estimated and hand-set engines / four prior widths | 61.9% / 64.9% | The hand-set engine is worse (59.7%) and drags the average; averaging widths changes little. |
| Dropping single links (ablation of all 42) | — | Nearly every link helps; no removal improves both halves by more than noise. |
| New inputs: oil price (WTI) and biotech index (XBI), for the weak Energy and Healthcare cells (`EXTRA_INPUTS`, `--extra-inputs oil,biotech`) | 64.1–64.9% with all their links vs 64.8–65.1% without; biotech → Healthcare IPOs alone 64.5–65.6% | No measurable gain. Estimated per named sector (`TARGETED`: a pooled coefficient averaged oil's Energy effect over five sectors). The price links are real (+10% oil → Energy valuations +4.0%, data weight 0.63; Industrials −1.4%) but the deal links are almost all prior (weight 0–0.1) and lowered deal direction 1–2 points: oil and biotech prices don't predict Energy or Healthcare deal counts in this history. Biotech → Healthcare IPOs lifted IPO direction ~1.5 points, but overall it is +0.5 at one prior width and −0.3 at another (one standard error ≈ 1.1 points), so not worth two new shock types on the Scenarios screen. The data stays fetched (`oilUsd`, `biotech` in macro_monthly.json, local only). Hand-set links used: oil → Energy valuation +moderate lag 0, Industrials valuation −weak 0, Energy deal count +moderate 1, Energy deal value +moderate 1, Energy IPOs +weak 1; biotech → Healthcare valuation +weak 0, Healthcare IPOs +strong 1, Healthcare deal count −weak 1, Healthcare deal value +moderate 0 (units: +10%). |

## What limits accuracy now

- **Where the misses are (with history):** Healthcare and Energy deal counts (49% / 53%) and Energy deal values (53%);
  Tech, Financials and Industrials deal counts are right 70–73% of the time. Deal counts one quarter ahead: 56%.
- **The data, not the tuning.** Every variant lands at 0.104–0.108 without history. Across all four regressions only four coefficients
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
