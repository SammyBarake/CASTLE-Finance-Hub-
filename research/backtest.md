# Ripple engine backtest

Generated 2026-10-02T09:56:34Z by `ingest/backtest.ts` (`npm run backtest`). Do not edit by hand.

## How it works

At each of 31 quarters (2019Q1 to 2026Q3) the links are re-estimated using only earlier data. The engine gets that quarter's real macro changes and sector ETF moves (less the part it already puts down to the macro changes) and predicts the next 4 quarters. Deal and IPO outcomes are measured against the average of the four quarters before (plus trend), with the calendar pattern taken out (deals dip in Q1, IPOs bunch in Q2; measured from earlier quarters only); valuations against the quarter before. Ideas tried to improve on this, kept or rejected, are in `research/experiments.md`.

- **Skill**: 1 − squared error ÷ squared error of predicting "no change from trend". Above 0 beats it; 1 would be perfect.
- **Direction**: share of predicted moves (0.5 points or more) with the right sign. A coin flip scores 50%.
- **Slope**: what happened regressed on what was predicted. 1 = effects sized right; below 1 = overstated.

## Chosen settings

**estimated (priors ×0.5), 2 rounds, fade 0.85/1/1/0.55**. Average skill 0.108 (previous settings 0.081, hand-set links 0.081, no links 0.081). Direction right 59% of the time overall, 55% for deals and IPOs.

| Period | Chosen | Previous | Hand-set |
|---|---|---|---|
| 2019Q1–2022Q4 | 0.139 | 0.101 | 0.098 |
| 2023Q1–2026Q3 | 0.061 | 0.054 | 0.058 |

## By feature and quarter ahead (chosen settings)

| Feature | Q | n | Skill | Direction | Slope |
|---|---|---|---|---|---|
| Valuation | Q2 | 150 | 0.350 | 74% | 0.75 |
| Valuation | Q3 | 145 | 0.370 | 72% | 1.04 |
| Valuation | Q4 | 140 | 0.260 | 68% | 1.19 |
| Deal count | Q1 | 95 | 0.000 | 53% | 0.86 |
| Deal count | Q2 | 90 | 0.060 | 55% | 1.43 |
| Deal count | Q3 | 85 | 0.100 | 62% | 1.78 |
| Deal count | Q4 | 80 | 0.090 | 55% | 1.7 |
| Deal value | Q1 | 95 | -0.010 | 50% | -1.48 |
| Deal value | Q2 | 90 | -0.010 | 47% | 0.1 |
| Deal value | Q3 | 85 | 0.000 | 50% | 0.3 |
| Deal value | Q4 | 80 | 0.000 | 52% | 0.34 |
| IPO count | Q1 | 155 | 0.020 | 55% | 1.6 |
| IPO count | Q2 | 150 | 0.150 | 60% | 1.29 |
| IPO count | Q3 | 145 | 0.000 | 57% | 0.53 |
| IPO count | Q4 | 140 | 0.020 | 56% | 1.16 |

## Every setup tried

Fade per feature: valuation / deal count / deal value / IPO count.

| Setup | Score | Valuation | Deal count | Deal value | IPO count |
|---|---|---|---|---|---|
| estimated (priors ×0.5), 2 rounds, fade 0.85/1/1/0.55 | 0.108 | 0.327 | 0.063 | -0.005 | 0.047 |
| estimated (priors ×0.75), 2 rounds, fade 0.85/1/0.4/0.55 | 0.108 | 0.327 | 0.057 | -0.002 | 0.05 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 0.85/1/0.85/0.55 | 0.108 | 0.32 | 0.063 | -0.005 | 0.053 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 2 rounds, fade 0.85/1/0.85/0.55 | 0.107 | 0.32 | 0.063 | -0.005 | 0.048 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 0.85/1/0.85/0.55 | 0.107 | 0.323 | 0.063 | -0.005 | 0.048 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 0.85/1/0.4/0.4 | 0.107 | 0.32 | 0.06 | -0.002 | 0.05 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 0.85/1/0.85/0.4 | 0.107 | 0.327 | 0.06 | -0.005 | 0.045 |
| estimated (priors ×0.25), 2 rounds, fade 0.85/1/1/0.7 | 0.106 | 0.317 | 0.063 | -0.005 | 0.047 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 0.85/1/0.4/0.55 | 0.106 | 0.317 | 0.055 | -0.002 | 0.053 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 2 rounds, fade 0.85/1/0.7/0.55 | 0.106 | 0.323 | 0.055 | -0.005 | 0.05 |
| estimated (priors ×1), 2 rounds, fade 0.85/1/0.7/0.4 | 0.105 | 0.323 | 0.055 | -0.002 | 0.045 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 2 rounds, fade 0.85/1/0.7/0.55 | 0.105 | 0.32 | 0.055 | -0.005 | 0.05 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 2 rounds, fade 0.85/1/0.4/0.4 | 0.104 | 0.313 | 0.053 | -0.002 | 0.05 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 0.85/1/0.7/0.55 | 0.103 | 0.31 | 0.055 | -0.005 | 0.053 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 2 rounds, fade 0.85/1/0.55/0.55 | 0.103 | 0.31 | 0.053 | -0.005 | 0.053 |
| estimated (priors ×0.25), direct effects, fade 1/1/0.85/0.55 | 0.101 | 0.33 | 0.043 | -0.002 | 0.033 |
| estimated (priors ×0.5), direct effects, fade 1/1/0.7/0.55 | 0.1 | 0.33 | 0.04 | -0.002 | 0.033 |
| estimated (priors ×0.75), direct effects, fade 1/1/0.7/0.55 | 0.1 | 0.33 | 0.038 | -0.002 | 0.033 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), direct effects, fade 1/1/0.7/0.7 | 0.1 | 0.33 | 0.04 | -0.002 | 0.033 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/0.55/0.7 | 0.1 | 0.33 | 0.033 | -0.002 | 0.038 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/0.7/0.7 | 0.1 | 0.33 | 0.038 | -0.002 | 0.033 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/0.7/0.55 | 0.1 | 0.33 | 0.038 | -0.002 | 0.033 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/0.55/0.55 | 0.1 | 0.33 | 0.033 | -0.002 | 0.04 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/0.7/0.55 | 0.1 | 0.33 | 0.038 | -0.002 | 0.033 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/0.55/0.55 | 0.1 | 0.33 | 0.038 | -0.002 | 0.033 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/0.55/0.7 | 0.1 | 0.33 | 0.033 | -0.002 | 0.038 |
| estimated (priors ×1), direct effects, fade 1/1/0.55/0.4 | 0.099 | 0.33 | 0.038 | -0.002 | 0.03 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/0.7/0.55 | 0.099 | 0.33 | 0.035 | -0.002 | 0.033 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/0.55/0.7 | 0.099 | 0.33 | 0.03 | -0.002 | 0.038 |
| estimated (priors ×0.5), 3 rounds, fade 0.85/1/0.85/0.4 | 0.099 | 0.287 | 0.068 | -0.005 | 0.045 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/0.85/0.55 | 0.099 | 0.287 | 0.07 | -0.005 | 0.045 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/0.55/0.7 | 0.098 | 0.33 | 0.035 | -0.002 | 0.03 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 0.85/1/0.85/0.55 | 0.098 | 0.28 | 0.068 | -0.005 | 0.048 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 0.85/1/0.85/0.55 | 0.098 | 0.28 | 0.068 | -0.005 | 0.048 |
| estimated (priors ×0.25), 3 rounds, fade 0.85/1/0.85/0.55 | 0.097 | 0.28 | 0.07 | -0.005 | 0.043 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/0.7/0.4 | 0.097 | 0.283 | 0.068 | -0.005 | 0.042 |
| hand-set, direct effects, fade 1/1/0.85/0.4 | 0.096 | 0.32 | 0.038 | -0.002 | 0.028 |
| estimated (priors ×0.75), 3 rounds, fade 0.85/1/0.7/0.55 | 0.096 | 0.283 | 0.065 | -0.005 | 0.04 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/0.55/0.7 | 0.096 | 0.28 | 0.068 | -0.005 | 0.04 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 3 rounds, fade 0.85/1/0.7/0.55 | 0.096 | 0.277 | 0.068 | -0.005 | 0.045 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 3 rounds, fade 0.85/1/0.7/0.7 | 0.095 | 0.273 | 0.068 | -0.005 | 0.043 |
| estimated (priors ×2), 2 rounds, fade 0.85/1/0.4/0.4 | 0.094 | 0.31 | 0.038 | 0 | 0.028 |
| estimated (priors ×2), direct effects, fade 1/1/0.55/0.4 | 0.093 | 0.33 | 0.03 | -0.002 | 0.015 |
| estimated (priors ×1), 3 rounds, fade 0.85/1/0.55/0.4 | 0.093 | 0.277 | 0.06 | -0.002 | 0.038 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 0.85/1/0.7/0.7 | 0.093 | 0.263 | 0.065 | -0.005 | 0.048 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 0.85/1/0.85/0.55 | 0.093 | 0.267 | 0.06 | -0.005 | 0.048 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 3 rounds, fade 0.85/1/0.7/0.55 | 0.091 | 0.26 | 0.06 | -0.005 | 0.048 |
| hand-set, 2 rounds, fade 1/1/0.85/0.55 | 0.088 | 0.27 | 0.05 | -0.005 | 0.038 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 3 rounds, fade 0.85/1/0.55/0.7 | 0.088 | 0.253 | 0.06 | -0.005 | 0.045 |
| estimated (priors ×2), 3 rounds, fade 0.7/1/0.7/0.4 | 0.076 | 0.253 | 0.043 | -0.002 | 0.008 |
| hand-set, 3 rounds, fade 0.85/1/0.7/0.4 | 0.055 | 0.17 | 0.04 | -0.007 | 0.018 |

## Caveats

- Settings chosen on the same quarters they are scored on flatter them a little; the two halves show whether the choice holds.
- Deal figures in weak sector-years (2019–2020 and a few earlier) can't be scored, so deal results lean on 2021 onward.
- Quarterly deal and IPO counts are noisy: most of their movement is not explained by macro or market moves, so skill stays small even when the direction is right.
