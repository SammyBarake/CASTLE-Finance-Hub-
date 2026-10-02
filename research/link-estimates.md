# Ripple links: hand-set vs estimated

Generated 2026-10-02 06:04 UTC by `research/estimate_links.py` (`npm run estimate`). Do not edit by hand.

## Summary

- Data: 47 quarters (2015Q1 to 2026Q3) × 5 sectors, from `sector_monthly` and `macro_monthly`.
- 18 of 38 links now rest mainly on the data (data weight ≥ 50%) and drop the "assumption" badge; 20 are still mostly the hand-set prior and keep it.
- Among the data-driven links: 9 agree with the hand-set value (inside the 90% range), 3 are stronger and 4 weaker than assumed, 1 flipped direction, 0 lean the other way without a clear sign, and 1 turned out too weak to matter.
- 1 hand-set sector-specific macro link merged into the common effect: the data finds no separate sector effect (Baa spread → Valuation (Financials, same quarter)).
- Weak sector-years left out of the deal figures: 2015: Tech, Healthcare, Energy, Industrials; 2016: Tech, Energy; 2017: Healthcare, Financials; 2018: Energy; 2019: all sectors; 2020: all sectors.

## The biggest surprises

Ranked by how far the data moved a link from its hand-set value (in prior standard deviations, times its data weight); flips first.

1. **IPO count → Valuation (1 quarter later)** (flipped). A 10% rise in ipo count goes with 0.4% higher valuation 1 quarter later (90% range +0.1% to +0.6%); we had assumed 2.0% lower. We had assumed: "A wave of new listings adds share supply to the sector and weighs a little on its valuations."
2. **Deal value → Valuation (same quarter)** (too weak). A 10% rise in deal value goes with 0.1% lower valuation same quarter (90% range −0.2% to +0.0%); we had assumed 2.0% higher. We had assumed: "Takeover activity makes investors price a takeover premium into the remaining companies in the sector."
3. **Energy → Industrials** (weaker). About 6% of a move in Energy reaches Industrials (90% range +0.03 to +0.09); we had assumed 50%. Input-output links alone say +0.01, the ETFs' co-movement beyond the market +0.10. We had assumed: "Oil and gas activity drives demand for equipment, pipelines, chemicals and transport, so energy shocks spill straight into industrials."

## Feature links (C)

Units: % per 1% move. Data alone = the OLS coefficient (± standard error) before shrinkage. Data weight = how much of the estimate comes from the data rather than the prior.

| Link | Hand-set | Data alone | Estimated | 90% range | n | Data weight | Verdict |
|---|---|---|---|---|---|---|---|
| Valuation → IPO count (1 quarter later) | +1.00 | +1.22 ± 0.49 | +1.38 | +0.77 to +2.00 | 220 | 66% | agreed |
| Valuation → IPO count (2 quarters later) | +0.50 | +0.15 ± 0.49 | +0.37 | +0.00 to +0.74 | 220 | 30% | agreed (mostly prior) |
| Valuation → IPO count (same quarter) | +0.20 | +0.39 ± 0.46 | +0.26 | +0.11 to +0.43 | 220 | 7% | agreed (mostly prior) |
| Valuation → Deal value (same quarter) | +0.50 | +0.79 ± 1.49 | +0.45 | +0.04 to +0.82 | 145 | 4% | agreed (mostly prior) |
| Valuation → Deal value (1 quarter later) | +0.50 | +1.45 ± 1.55 | +0.48 | +0.09 to +0.88 | 145 | 4% | agreed (mostly prior) |
| Valuation → Deal count (1 quarter later) | +0.50 | −0.10 ± 0.36 | +0.27 | −0.06 to +0.62 | 145 | 37% | agreed (mostly prior) |
| Valuation → Valuation (same quarter) | +0.20 | — | +0.20 | +0.02 to +0.37 | 0 | 0% | prior only: cross-sector co-movement: not estimable in a within-sector panel |
| Deal count → Deal value (same quarter) | +1.00 | +0.66 ± 0.38 | +0.78 | +0.28 to +1.31 | 145 | 71% | agreed |
| Deal value → Valuation (same quarter) | +0.20 | −0.01 ± 0.01 | −0.01 | −0.02 to +0.00 | 220 | 100% | too weak to matter |
| Deal count → IPO count (1 quarter later) | −0.20 | −0.16 ± 0.18 | −0.17 | −0.30 to −0.02 | 220 | 29% | agreed (mostly prior) |
| IPO count → Valuation (1 quarter later) | −0.20 | +0.03 ± 0.01 | +0.04 | +0.01 to +0.06 | 220 | 99% | **flipped** |
| IPO count → Deal count (1 quarter later) | +0.20 | +0.07 ± 0.06 | +0.12 | +0.04 to +0.17 | 145 | 79% | weaker than assumed |

## Sector links (L)

Units: share of a move. Data alone = the IO / ETF blend before shrinkage. Data weight = how much of the estimate comes from the data rather than the prior.

| Link | Hand-set | Data alone | Estimated | 90% range | n | Data weight | Verdict | IO | ETF |
|---|---|---|---|---|---|---|---|---|---|
| Energy → Industrials | +0.50 | +0.06 | +0.06 | +0.03 to +0.09 | 140 | 99% | weaker than assumed | +0.01 | +0.10 |
| Industrials → Energy | +0.25 | +0.48 | +0.39 | +0.25 to +0.51 | 140 | 58% | agreed | +0.35 | +0.62 |
| Financials → Tech | +0.25 | +0.17 | +0.19 | +0.08 to +0.30 | 140 | 70% | agreed | +0.05 | +0.29 |
| Financials → Healthcare | +0.25 | +0.15 | +0.16 | +0.10 to +0.24 | 140 | 89% | weaker than assumed | +0.00 | +0.29 |
| Financials → Energy | +0.25 | +0.45 | +0.38 | +0.27 to +0.50 | 140 | 67% | stronger than assumed | +0.05 | +0.85 |
| Financials → Industrials | +0.25 | +0.27 | +0.27 | +0.20 to +0.33 | 140 | 91% | agreed | +0.05 | +0.48 |
| Tech → Healthcare | +0.25 | +0.07 | +0.08 | +0.04 to +0.13 | 140 | 95% | weaker than assumed | +0.00 | +0.14 |
| Healthcare → Tech | +0.10 | +0.17 | +0.13 | +0.08 to +0.19 | 140 | 50% | agreed | +0.03 | +0.30 |
| Tech → Industrials | +0.10 | +0.17 | +0.16 | +0.12 to +0.19 | 140 | 82% | stronger than assumed | +0.03 | +0.31 |
| Tech → Financials | +0.10 | +0.07 | +0.08 | +0.04 to +0.13 | 140 | 64% | agreed | +0.02 | +0.12 |
| Industrials → Financials | +0.10 | +0.38 | +0.25 | +0.19 to +0.31 | 140 | 53% | stronger than assumed | +0.19 | +0.58 |

## Macro links (M)

Units: % per unit (1 pp; 10 VIX points). Data alone = the OLS coefficient before shrinkage. Data weight = how much of the estimate comes from the data rather than the prior.

| Link | Hand-set | Data alone | Estimated | 90% range | n | Data weight | Verdict |
|---|---|---|---|---|---|---|---|
| Fed funds → Deal count (all sectors, 1 quarter later) | −5.0 | +7.8 | −5.1 | −9.1 to −1.4 | 145 | 13% | agreed (mostly prior) |
| Fed funds → Deal value (all sectors, 1 quarter later) | −5.0 | +53.7 | −5.1 | −9.0 to −0.9 | 145 | 1% | agreed (mostly prior) |
| Fed funds → IPO count (all sectors, 1 quarter later) | −5.0 | +21.1 | −5.2 | −9.2 to −1.4 | 220 | 7% | agreed (mostly prior) |
| 10-year yield → Valuation (Tech, same quarter) | −10.0 | −9.5 | −11.3 | −16.7 to −6.1 | 44 | 60% | agreed; sector-specific (F-test p = 0.0) |
| 10-year yield → Valuation (Healthcare, same quarter) | −5.0 | −2.6 | −5.0 | −8.1 to −1.8 | 44 | 27% | agreed (mostly prior); sector-specific (F-test p = 0.0) |
| 10-year yield → Valuation (Industrials, Energy, same quarter) | −2.0 | +7.8 | −1.6 | −2.9 to −0.6 | 88 | 6% | agreed (mostly prior); sector-specific (F-test p = 0.0) |
| 10-year yield → Valuation (Financials, same quarter) | +2.0 | +4.5 | +2.1 | +0.4 to +3.6 | 44 | 5% | agreed (mostly prior); sector-specific (F-test p = 0.0) |
| Baa spread → Deal value (all sectors, same quarter) | −10.0 | +191.5 | −9.7 | −17.1 to −1.3 | 145 | 1% | agreed (mostly prior) |
| Baa spread → Deal count (all sectors, same quarter) | −5.0 | −11.7 | −5.3 | −9.2 to −1.0 | 145 | 2% | agreed (mostly prior) |
| Baa spread → IPO count (all sectors, 1 quarter later) | −5.0 | −82.6 | −5.2 | −9.6 to −0.8 | 220 | 2% | agreed (mostly prior) |
| Baa spread → Valuation (all sectors, same quarter) | −5.0 | −2.1 | −6.0 | −11.3 to −1.3 | 220 | 39% | agreed (mostly prior) |
| Baa spread → Valuation (Financials, same quarter) | −5.0 | 0.0 | 0.0 | 0.0 to 0.0 | 44 | 39% | merged into the common effect: no separate sector effect in the data (F-test p = 0.351) |
| VIX → IPO count (all sectors, same quarter) | −10.0 | −20.9 | −11.8 | −15.6 to −8.1 | 220 | 5% | agreed (mostly prior); sector-specific (F-test p = 0.013) |
| VIX → Deal count (all sectors, same quarter) | −5.0 | +0.1 | −4.6 | −8.5 to −0.6 | 145 | 7% | agreed (mostly prior) |
| VIX → Valuation (all sectors, same quarter) | −5.0 | −12.7 | −8.8 | −13.2 to −2.8 | 220 | 69% | agreed |

## Links the data suggests that the engine doesn't have

Coefficients with no hand-set link (prior 0) that came out clearly non-zero with mostly data behind them. Not added to the engine: each needs a reason first.

- Industrials → Tech: +0.33, 90% range +0.24 to +0.42, data weight 72% (IO +0.19, ETF +0.74)
- Industrials → Healthcare: +0.16, 90% range +0.09 to +0.25, data weight 78% (IO +0.03, ETF +0.40)
- Healthcare → Industrials: +0.15, 90% range +0.08 to +0.21, data weight 85% (IO +0.05, ETF +0.31)
- Healthcare → Financials: +0.14, 90% range +0.10 to +0.20, data weight 89% (IO +0.05, ETF +0.27)
- Tech → Energy: −0.12, 90% range −0.19 to −0.04, data weight 77% (IO +0.02, ETF −0.32)
- Energy → Financials: +0.10, 90% range +0.07 to +0.14, data weight 95% (IO +0.01, ETF +0.21)

## Sector-specific macro effects

A macro input gets its own coefficient per sector only when an F-test rejects a common effect (p < 0.05). Supported:

- 10-year yield → Valuation (same quarter): p = 0.000
- VIX → Deal value (same quarter): p = 0.018
- VIX → Deal value (1 quarter later): p = 0.030
- VIX → IPO count (same quarter): p = 0.013

## Regressions

| Target | Sector-quarters | Quarters | Within R² | Residual sd |
|---|---|---|---|---|
| Valuation | 220 | 44 | 0.48 | 8.8 |
| Deal count | 145 | 35 | 0.34 | 33.0 |
| Deal value | 145 | 35 | 0.55 | 134.7 |
| IPO count | 220 | 44 | 0.47 | 58.5 |

## Method

- **Panel**: quarterly, 5 sectors. Valuation = sector ETF log total return. Deal count, deal value and IPO count are log changes of log(x + c), c = 1 for counts and $100M for values. Deal and IPO growth winsorised at the 2.5th / 97.5th percentiles. Macro inputs are quarter-average changes (VIX per 10 points). Deal figures in weak sector-years are left out where they are the thing explained; as inputs they count as "no change" with a missing-data flag, so those quarters' ETF and macro data still count.
- **C and M**: one OLS per target feature with sector fixed effects (statsmodels), on the other features at lags 0–2, its own lags 1–2 as controls, and the four macro changes at lags 0–2. Lag-0 links are same-quarter associations: the data can't tell which way they run.
- **L**: half from BEA input-output tables (share of sector i's output driven by sector j's final demand, Leontief total requirements, 2015–2023, 71 industries mapped to the five sectors; pharma is 28% of chemicals and medical devices 58% of misc. manufacturing, from the 2017 detail table), half from monthly sector ETF returns (slope of sector i's own move on sector j's, after taking out the market, measured as the other three sectors' average so neither is in its own benchmark, and the four macro inputs, which have links of their own).
- **Shrinkage**: normal prior on every coefficient centred on its hand-set value (0 where no link exists), sd half its size (floors: 0.1 feature, 0.05 sector, 1 macro; 0.2 / 0.1 / 1 around zero). The posterior mean pulls toward the prior, harder where the data is noisy.
- **Ranges**: 1000 bootstrap runs resampling whole quarters (and a random IO year for L); each adds the prior's remaining uncertainty, (1 − data weight) × prior sd. 90% range = 5th–95th percentile.
- **Badge**: a link drops "assumption" when its data weight is at least 50%.
