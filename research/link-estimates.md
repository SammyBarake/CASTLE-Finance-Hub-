# Ripple links: hand-set vs estimated

Generated 2026-10-13 05:51 UTC by `research/estimate_links.py` (`npm run estimate`). Do not edit by hand.

## Summary

- Data: 67 quarters (2010Q1 to 2026Q3) × 5 sectors, from `sector_monthly` and `macro_monthly`.
- 7 of 38 links now rest mainly on the data (data weight ≥ 50%) and drop the "assumption" badge; 31 are still mostly the hand-set prior and keep it.
- Among the data-driven links: 1 agree with the hand-set value (inside the 90% range), 1 are stronger and 3 weaker than assumed, 0 flipped direction, 0 lean the other way without a clear sign, and 2 turned out too weak to matter.
- Weak sector-years left out of the deal figures: 2010: all sectors; 2011: Energy, Financials; 2012: Financials; 2013: Energy, Financials; 2014: Financials; 2016: Energy; 2019: Financials; 2020: all sectors.

## The biggest surprises

Ranked by how far the data moved a link from its hand-set value (in prior standard deviations, times its data weight); flips first.

1. **IPO count → Valuation (1 quarter later)** (too weak). A 10% rise in ipo count goes with 0.1% higher valuation 1 quarter later (90% range −0.1% to +0.4%); we had assumed 2.0% lower. We had assumed: "A wave of new listings adds share supply to the sector and weighs a little on its valuations."
2. **Deal value → Valuation (same quarter)** (too weak). A 10% rise in deal value goes with 0.1% higher valuation same quarter (90% range −0.0% to +0.1%); we had assumed 2.0% higher. We had assumed: "Takeover activity makes investors price a takeover premium into the remaining companies in the sector."
3. **Energy → Industrials** (weaker). About 7% of a move in Energy reaches Industrials (90% range +0.05 to +0.10); we had assumed 50%. Input-output links alone say +0.01, the ETFs' co-movement beyond the market +0.12. We had assumed: "Oil and gas activity drives demand for equipment, pipelines, chemicals and transport, so energy shocks spill straight into industrials."

## Feature links (C)

Units: % per 1% move. Data alone = the OLS coefficient (± standard error) before shrinkage. Data weight = how much of the estimate comes from the data rather than the prior.

| Link | Hand-set | Data alone | Estimated | 90% range | n | Data weight | Verdict |
|---|---|---|---|---|---|---|---|
| Valuation → IPO count (1 quarter later) | +1.00 | +1.32 ± 0.43 | +1.05 | +0.85 to +1.25 | 320 | 15% | agreed (mostly prior) |
| Valuation → IPO count (2 quarters later) | +0.50 | +0.16 ± 0.42 | +0.49 | +0.38 to +0.59 | 320 | 4% | agreed (mostly prior) |
| Valuation → IPO count (same quarter) | +0.20 | +0.30 ± 0.41 | +0.21 | +0.17 to +0.25 | 320 | 1% | agreed (mostly prior) |
| Valuation → Deal value (same quarter) | +0.50 | −0.07 ± 1.10 | +0.50 | +0.39 to +0.60 | 251 | 0% | agreed (mostly prior) |
| Valuation → Deal value (1 quarter later) | +0.50 | +1.52 ± 1.12 | +0.51 | +0.41 to +0.61 | 251 | 0% | agreed (mostly prior) |
| Valuation → Deal count (1 quarter later) | +0.50 | −0.15 ± 0.24 | +0.45 | +0.35 to +0.55 | 251 | 9% | agreed (mostly prior) |
| Valuation → Valuation (same quarter) | +0.20 | — | +0.20 | +0.02 to +0.37 | 0 | 0% | prior only: cross-sector co-movement: not estimable in a within-sector panel |
| Deal count → Deal value (same quarter) | +1.00 | +1.13 ± 0.30 | +1.00 | +0.80 to +1.20 | 251 | 23% | agreed (mostly prior) |
| Deal value → Valuation (same quarter) | +0.20 | 0.00 ± 0.00 | +0.01 | −0.00 to +0.01 | 320 | 97% | too weak to matter |
| Deal count → IPO count (1 quarter later) | −0.20 | −0.14 ± 0.16 | −0.20 | −0.24 to −0.16 | 320 | 5% | agreed (mostly prior) |
| IPO count → Valuation (1 quarter later) | −0.20 | +0.03 ± 0.01 | +0.01 | −0.01 to +0.04 | 320 | 90% | too weak to matter |
| IPO count → Deal count (1 quarter later) | +0.20 | +0.04 ± 0.04 | +0.13 | +0.09 to +0.16 | 251 | 42% | weaker than assumed (mostly prior) |

## Sector links (L)

Units: share of a move. Data alone = the IO / ETF blend before shrinkage. Data weight = how much of the estimate comes from the data rather than the prior.

| Link | Hand-set | Data alone | Estimated | 90% range | n | Data weight | Verdict | IO | ETF |
|---|---|---|---|---|---|---|---|---|---|
| Energy → Industrials | +0.50 | +0.07 | +0.07 | +0.05 to +0.10 | 200 | 98% | weaker than assumed | +0.01 | +0.12 |
| Industrials → Energy | +0.25 | +0.52 | +0.35 | +0.26 to +0.43 | 200 | 37% | stronger than assumed (mostly prior) | +0.35 | +0.69 |
| Financials → Tech | +0.25 | +0.19 | +0.22 | +0.14 to +0.29 | 200 | 48% | agreed (mostly prior) | +0.05 | +0.33 |
| Financials → Healthcare | +0.25 | +0.16 | +0.18 | +0.13 to +0.24 | 200 | 75% | weaker than assumed | +0.00 | +0.31 |
| Financials → Energy | +0.25 | +0.41 | +0.31 | +0.23 to +0.39 | 200 | 41% | agreed (mostly prior) | +0.05 | +0.76 |
| Financials → Industrials | +0.25 | +0.27 | +0.27 | +0.22 to +0.31 | 200 | 78% | agreed | +0.05 | +0.49 |
| Tech → Healthcare | +0.25 | +0.07 | +0.10 | +0.06 to +0.14 | 200 | 84% | weaker than assumed | +0.00 | +0.14 |
| Healthcare → Tech | +0.10 | +0.15 | +0.11 | +0.08 to +0.15 | 200 | 26% | agreed (mostly prior) | +0.03 | +0.27 |
| Tech → Industrials | +0.10 | +0.17 | +0.14 | +0.12 to +0.17 | 200 | 57% | stronger than assumed | +0.03 | +0.32 |
| Tech → Financials | +0.10 | +0.09 | +0.10 | +0.06 to +0.13 | 200 | 34% | agreed (mostly prior) | +0.02 | +0.16 |
| Industrials → Financials | +0.10 | +0.38 | +0.19 | +0.16 to +0.23 | 200 | 33% | stronger than assumed (mostly prior) | +0.19 | +0.58 |

## Macro links (M)

Units: % per unit (1 pp; 10 VIX points). Data alone = the OLS coefficient before shrinkage. Data weight = how much of the estimate comes from the data rather than the prior.

| Link | Hand-set | Data alone | Estimated | 90% range | n | Data weight | Verdict |
|---|---|---|---|---|---|---|---|
| Fed funds → Deal count (all sectors, 1 quarter later) | −5.0 | +18.8 | −5.1 | −7.1 to −3.1 | 251 | 6% | agreed (mostly prior) |
| Fed funds → Deal value (all sectors, 1 quarter later) | −5.0 | +30.5 | −5.0 | −7.1 to −3.0 | 251 | 0% | agreed (mostly prior) |
| Fed funds → IPO count (all sectors, 1 quarter later) | −5.0 | +4.4 | −5.1 | −7.2 to −3.0 | 320 | 2% | agreed (mostly prior) |
| 10-year yield → Valuation (Tech, same quarter) | −10.0 | −5.7 | −9.0 | −12.5 to −5.2 | 64 | 41% | agreed (mostly prior); sector-specific (F-test p = 0.0) |
| 10-year yield → Valuation (Healthcare, same quarter) | −5.0 | +0.2 | −4.5 | −6.2 to −2.5 | 64 | 15% | agreed (mostly prior); sector-specific (F-test p = 0.0) |
| 10-year yield → Valuation (Industrials, Energy, same quarter) | −2.0 | +9.0 | −1.7 | −2.3 to −1.1 | 128 | 3% | agreed (mostly prior); sector-specific (F-test p = 0.0) |
| 10-year yield → Valuation (Financials, same quarter) | +2.0 | +5.5 | +2.0 | +1.2 to +2.9 | 64 | 3% | agreed (mostly prior); sector-specific (F-test p = 0.0) |
| Baa spread → Deal value (all sectors, same quarter) | −10.0 | −19.2 | −10.1 | −14.2 to −5.8 | 251 | 0% | agreed (mostly prior) |
| Baa spread → Deal count (all sectors, same quarter) | −5.0 | −10.3 | −4.9 | −7.0 to −2.8 | 251 | 2% | agreed (mostly prior) |
| Baa spread → IPO count (all sectors, 1 quarter later) | −5.0 | −66.2 | −5.1 | −7.3 to −3.1 | 320 | 1% | agreed (mostly prior) |
| Baa spread → Valuation (all sectors, same quarter) | −5.0 | −2.9 | −5.4 | −6.4 to −4.3 | 320 | 9% | agreed (mostly prior); sector-specific (F-test p = 0.029) |
| Baa spread → Valuation (Financials, same quarter) | −5.0 | −6.2 | −5.4 | −9.1 to −2.0 | 64 | 22% | agreed (mostly prior); sector-specific (F-test p = 0.029) |
| VIX → IPO count (all sectors, same quarter) | −10.0 | −33.7 | −10.7 | −12.4 to −8.9 | 320 | 2% | agreed (mostly prior); sector-specific (F-test p = 0.001) |
| VIX → Deal count (all sectors, same quarter) | −5.0 | +8.5 | −4.2 | −6.3 to −2.1 | 251 | 6% | agreed (mostly prior) |
| VIX → Valuation (all sectors, same quarter) | −5.0 | −11.9 | −6.4 | −7.9 to −4.9 | 320 | 22% | agreed (mostly prior); sector-specific (F-test p = 0.037) |

## Links the data suggests that the engine doesn't have

Coefficients with no hand-set link (prior 0) that came out clearly non-zero with mostly data behind them. Not added to the engine: each needs a reason first.

- Industrials → Tech: +0.23, 90% range +0.17 to +0.28, data weight 51% (IO +0.19, ETF +0.71)
- Healthcare → Financials: +0.12, 90% range +0.08 to +0.17, data weight 72% (IO +0.05, ETF +0.29)
- Industrials → Healthcare: +0.11, 90% range +0.06 to +0.16, data weight 55% (IO +0.03, ETF +0.38)
- Healthcare → Industrials: +0.11, 90% range +0.06 to +0.16, data weight 64% (IO +0.05, ETF +0.30)

## Sector-specific macro effects

A macro input gets its own coefficient per sector only when an F-test rejects a common effect (p < 0.05). Supported:

- 10-year yield → Valuation (same quarter): p = 0.000
- Baa spread → Valuation (same quarter): p = 0.029
- VIX → Valuation (same quarter): p = 0.037
- Baa spread → Deal count (2 quarters later): p = 0.013
- Baa spread → Deal value (1 quarter later): p = 0.034
- VIX → Deal value (1 quarter later): p = 0.010
- VIX → IPO count (same quarter): p = 0.001
- VIX → IPO count (2 quarters later): p = 0.003

## Regressions

| Target | Sector-quarters | Quarters | Within R² | Residual sd |
|---|---|---|---|---|
| Valuation | 320 | 64 | 0.51 | 7.9 |
| Deal count | 251 | 57 | 0.50 | 26.2 |
| Deal value | 251 | 57 | 0.40 | 122.4 |
| IPO count | 320 | 64 | 0.47 | 55.8 |

## Method

- **Panel**: quarterly, 5 sectors. Valuation = sector ETF log total return. Deal count, deal value and IPO count are log changes of log(x + c), c = 1 for counts and $100M for values. Deal and IPO growth winsorised at the 2.5th / 97.5th percentiles. Macro inputs are quarter-average changes (VIX per 10 points). Deal figures in weak sector-years are left out where they are the thing explained; as inputs they count as "no change" with a missing-data flag, so those quarters' ETF and macro data still count.
- **C and M**: one OLS per target feature with sector fixed effects (statsmodels), on the other features at lags 0–2, its own lags 1–2 as controls, and the four macro changes at lags 0–2. Lag-0 links are same-quarter associations: the data can't tell which way they run.
- **L**: half from BEA input-output tables (share of sector i's output driven by sector j's final demand, Leontief total requirements, 2015–2023, 71 industries mapped to the five sectors; pharma is 28% of chemicals and medical devices 58% of misc. manufacturing, from the 2017 detail table), half from monthly sector ETF returns (slope of sector i's own move on sector j's, after taking out the market, measured as the other three sectors' average so neither is in its own benchmark, and the four macro inputs, which have links of their own).
- **Shrinkage**: normal prior on every coefficient centred on its hand-set value (0 where no link exists), sd half its size (floors: 0.1 feature, 0.05 sector, 1 macro; 0.2 / 0.1 / 1 around zero), times 0.25 for feature links, 0.5 for sector links and 0.5 for macro links: the prior widths that forecast best out of sample (`npm run backtest`, research/backtest.md). The posterior mean pulls toward the prior, harder where the data is noisy.
- **Ranges**: 1000 bootstrap runs resampling whole quarters (and a random IO year for L); each adds the prior's remaining uncertainty, (1 − data weight) × prior sd. 90% range = 5th–95th percentile.
- **Badge**: a link drops "assumption" when its data weight is at least 50%.
