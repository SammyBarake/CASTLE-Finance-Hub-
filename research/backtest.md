# Ripple engine backtest

Generated 2026-10-02T08:28:02Z by `ingest/backtest.ts` (`npm run backtest`). Do not edit by hand.

## How it works

At each of 31 quarters (2019Q1 to 2026Q3) the links are re-estimated using only earlier data. The engine gets that quarter's real macro changes and sector ETF moves (less the part it already puts down to the macro changes) and predicts the next 4 quarters. Deal and IPO outcomes are measured against the average of the four quarters before (plus trend), valuations against the quarter before.

- **Skill**: 1 − squared error ÷ squared error of predicting "no change from trend". Above 0 beats it; 1 would be perfect.
- **Direction**: share of predicted moves (0.5 points or more) with the right sign. A coin flip scores 50%.
- **Slope**: what happened regressed on what was predicted. 1 = effects sized right; below 1 = overstated.

## Chosen settings

**estimated (priors ×0.5), 2 rounds, fade 0.85/1/0.85/0.55**. Average skill 0.106 (previous settings 0.08, hand-set links 0.08, no links 0.081). Direction right 60% of the time overall, 56% for deals and IPOs.

| Period | Chosen | Previous | Hand-set |
|---|---|---|---|
| 2019Q1–2022Q4 | 0.14 | 0.101 | 0.098 |
| 2023Q1–2026Q3 | 0.061 | 0.053 | 0.058 |

## By feature and quarter ahead (chosen settings)

| Feature | Q | n | Skill | Direction | Slope |
|---|---|---|---|---|---|
| Valuation | Q2 | 150 | 0.350 | 74% | 0.75 |
| Valuation | Q3 | 145 | 0.370 | 72% | 1.04 |
| Valuation | Q4 | 140 | 0.260 | 68% | 1.19 |
| Deal count | Q1 | 95 | 0.000 | 51% | 1.13 |
| Deal count | Q2 | 90 | 0.040 | 51% | 1.18 |
| Deal count | Q3 | 85 | 0.090 | 63% | 1.65 |
| Deal count | Q4 | 80 | 0.100 | 57% | 1.94 |
| Deal value | Q1 | 95 | -0.010 | 47% | -1.66 |
| Deal value | Q2 | 90 | -0.020 | 45% | -0.32 |
| Deal value | Q3 | 85 | 0.010 | 54% | 0.86 |
| Deal value | Q4 | 80 | 0.000 | 54% | 0.94 |
| IPO count | Q1 | 155 | 0.040 | 59% | 2.33 |
| IPO count | Q2 | 150 | 0.100 | 64% | 1.01 |
| IPO count | Q3 | 145 | 0.020 | 60% | 0.7 |
| IPO count | Q4 | 140 | 0.020 | 54% | 1.11 |

## Every setup tried

Fade per feature: valuation / deal count / deal value / IPO count.

| Setup | Score | Valuation | Deal count | Deal value | IPO count |
|---|---|---|---|---|---|
| estimated (priors ×0.5), 2 rounds, fade 0.85/1/0.85/0.55 | 0.106 | 0.327 | 0.058 | -0.005 | 0.045 |
| estimated (priors ×0.25), 2 rounds, fade 0.85/1/0.85/0.7 | 0.105 | 0.317 | 0.06 | -0.002 | 0.045 |
| estimated (priors ×0.75), 2 rounds, fade 0.85/1/0.7/0.55 | 0.104 | 0.327 | 0.055 | -0.005 | 0.04 |
| estimated (priors ×1), 2 rounds, fade 0.85/1/0.4/0.55 | 0.102 | 0.323 | 0.053 | -0.005 | 0.038 |
| estimated (priors ×0.25), direct effects, fade 1/1/1/0.55 | 0.1 | 0.33 | 0.04 | -0.005 | 0.033 |
| estimated (priors ×0.5), direct effects, fade 1/1/1/0.7 | 0.098 | 0.33 | 0.038 | -0.005 | 0.03 |
| estimated (priors ×0.75), direct effects, fade 1/1/1/0.55 | 0.097 | 0.33 | 0.035 | -0.005 | 0.028 |
| estimated (priors ×1), direct effects, fade 1/1/1/0.55 | 0.097 | 0.33 | 0.033 | -0.005 | 0.028 |
| estimated (priors ×0.5), 3 rounds, fade 0.85/1/0.7/0.55 | 0.097 | 0.287 | 0.065 | -0.005 | 0.04 |
| estimated (priors ×0.25), 3 rounds, fade 0.85/1/0.7/0.7 | 0.096 | 0.28 | 0.068 | -0.005 | 0.04 |
| hand-set, direct effects, fade 1/1/1/0.55 | 0.095 | 0.32 | 0.038 | -0.005 | 0.028 |
| estimated (priors ×0.75), 3 rounds, fade 0.85/1/0.85/0.55 | 0.094 | 0.283 | 0.06 | -0.005 | 0.038 |
| estimated (priors ×1), 3 rounds, fade 0.85/1/0.4/0.4 | 0.091 | 0.277 | 0.06 | -0.002 | 0.03 |
| estimated (priors ×2), direct effects, fade 1/1/0.85/0.55 | 0.09 | 0.33 | 0.025 | -0.005 | 0.01 |
| estimated (priors ×2), 2 rounds, fade 0.85/1/0.85/0.4 | 0.09 | 0.31 | 0.038 | -0.005 | 0.015 |
| hand-set, 2 rounds, fade 1/1/1/0.7 | 0.088 | 0.27 | 0.05 | -0.005 | 0.035 |
| estimated (priors ×2), 3 rounds, fade 0.7/1/0.7/0.4 | 0.072 | 0.253 | 0.038 | -0.002 | -0.002 |
| hand-set, 3 rounds, fade 0.85/1/0.7/0.4 | 0.055 | 0.17 | 0.04 | -0.007 | 0.018 |

## Caveats

- Settings chosen on the same quarters they are scored on flatter them a little; the two halves show whether the choice holds.
- Deal figures in weak sector-years (2019–2020 and a few earlier) can't be scored, so deal results lean on 2021 onward.
- Quarterly deal and IPO counts are noisy: most of their movement is not explained by macro or market moves, so skill stays small even when the direction is right.
