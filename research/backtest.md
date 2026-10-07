# Ripple engine backtest

Generated 2026-10-07T01:36:13Z by `ingest/backtest.ts` (`npm run backtest`). Do not edit by hand.

## How it works

At each of 31 quarters (2019Q1 to 2026Q3) the links are re-estimated using only earlier data. The engine gets that quarter's real macro changes and sector ETF moves (less the part it already puts down to the macro changes) and predicts the next 4 quarters. Deal and IPO outcomes are measured against the average of the four quarters before (plus trend), with the calendar pattern taken out (deals dip in Q1, IPOs bunch in Q2; measured from earlier quarters only); valuations against the quarter before. Ideas tried to improve on this, kept or rejected, are in `research/experiments.md`.

- **Skill**: 1 − squared error ÷ squared error of predicting "no change from trend". Above 0 beats it; 1 would be perfect.
- **Direction**: share of predicted moves (0.5 points or more) with the right sign. A coin flip scores 50%.
- **Slope**: what happened regressed on what was predicted. 1 = effects sized right; below 1 = overstated.

## Chosen settings

**estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/1/0.55**. Average skill 0.119 (previous settings 0.088, hand-set links 0.087, no links 0.081). Direction right 60% of the time overall, 56% for deals and IPOs.

| Period | Chosen | Previous | Hand-set |
|---|---|---|---|
| 2019Q1–2022Q4 | 0.153 | 0.105 | 0.099 |
| 2023Q1–2026Q3 | 0.061 | 0.059 | 0.061 |

## By feature and quarter ahead (chosen settings)

| Feature | Q | n | Skill | Direction | Slope |
|---|---|---|---|---|---|
| Valuation | Q2 | 150 | 0.410 | 74% | 0.91 |
| Valuation | Q3 | 145 | 0.350 | 73% | 1.22 |
| Valuation | Q4 | 140 | 0.240 | 68% | 1.39 |
| Deal count | Q1 | 111 | 0.010 | 55% | 1.62 |
| Deal count | Q2 | 102 | 0.100 | 64% | 1.66 |
| Deal count | Q3 | 93 | 0.090 | 58% | 1.44 |
| Deal count | Q4 | 84 | 0.120 | 64% | 1.66 |
| Deal value | Q1 | 111 | 0.000 | 51% | 0.27 |
| Deal value | Q2 | 102 | 0.000 | 50% | 0.53 |
| Deal value | Q3 | 93 | 0.030 | 51% | 1.23 |
| Deal value | Q4 | 84 | 0.020 | 57% | 1.13 |
| IPO count | Q1 | 155 | 0.030 | 56% | 1.58 |
| IPO count | Q2 | 150 | 0.150 | 59% | 1.3 |
| IPO count | Q3 | 145 | 0.010 | 58% | 0.56 |
| IPO count | Q4 | 140 | 0.010 | 56% | 1.06 |

## Every setup tried

Fade per feature: valuation / deal count / deal value / IPO count.

| Setup | Score | Valuation | Deal count | Deal value | IPO count |
|---|---|---|---|---|---|
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/1/0.55 | 0.119 | 0.333 | 0.08 | 0.013 | 0.05 |
| estimated (priors ×0.5), 3 rounds, fade 1/1/1/0.55 | 0.118 | 0.33 | 0.08 | 0.01 | 0.053 |
| estimated (priors ×0.75), 3 rounds, fade 0.85/1/1/0.4 | 0.118 | 0.333 | 0.075 | 0.013 | 0.05 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55 | 0.118 | 0.33 | 0.08 | 0.01 | 0.05 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55 | 0.118 | 0.33 | 0.083 | 0.01 | 0.048 |
| estimated (priors ×0.5), 2 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.073 | 0.01 | 0.053 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.075 | 0.01 | 0.053 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.075 | 0.01 | 0.053 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.073 | 0.01 | 0.053 |
| estimated (priors ×1), 3 rounds, fade 0.85/1/1/0.55 | 0.117 | 0.333 | 0.073 | 0.013 | 0.048 |
| estimated (priors ×0.25), 3 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.078 | 0.013 | 0.048 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.078 | 0.01 | 0.05 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.078 | 0.01 | 0.05 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.075 | 0.01 | 0.053 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55 | 0.117 | 0.33 | 0.078 | 0.01 | 0.05 |
| estimated (priors ×0.25), 2 rounds, fade 1/1/1/0.55 | 0.116 | 0.33 | 0.075 | 0.01 | 0.05 |
| estimated (priors ×0.75), 2 rounds, fade 1/1/1/0.4 | 0.116 | 0.33 | 0.073 | 0.01 | 0.05 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55 | 0.116 | 0.33 | 0.075 | 0.01 | 0.048 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55 | 0.116 | 0.33 | 0.073 | 0.01 | 0.05 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/0.85/0.55 | 0.116 | 0.33 | 0.07 | 0.01 | 0.053 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55 | 0.116 | 0.33 | 0.07 | 0.01 | 0.053 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55 | 0.116 | 0.33 | 0.07 | 0.01 | 0.053 |
| estimated (priors ×1), 2 rounds, fade 0.85/1/1/0.4 | 0.115 | 0.33 | 0.073 | 0.01 | 0.048 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/0.85/0.55 | 0.115 | 0.33 | 0.068 | 0.008 | 0.055 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55 | 0.115 | 0.33 | 0.075 | 0.01 | 0.045 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55 | 0.115 | 0.33 | 0.073 | 0.008 | 0.05 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.4 | 0.115 | 0.33 | 0.07 | 0.005 | 0.053 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55 | 0.115 | 0.33 | 0.068 | 0.01 | 0.053 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55 | 0.114 | 0.327 | 0.065 | 0.008 | 0.055 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55 | 0.114 | 0.327 | 0.068 | 0.008 | 0.053 |
| estimated (priors ×2), 3 rounds, fade 0.85/1/1/0.4 | 0.112 | 0.333 | 0.065 | 0.01 | 0.038 |
| estimated (priors ×2), 2 rounds, fade 0.85/1/1/0.4 | 0.11 | 0.33 | 0.065 | 0.008 | 0.038 |
| estimated (priors ×0.5), direct effects, fade 1/1/1/0.55 | 0.107 | 0.33 | 0.06 | 0.003 | 0.033 |
| estimated (priors ×0.75), direct effects, fade 1/1/1/0.55 | 0.107 | 0.33 | 0.06 | 0.003 | 0.033 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55 | 0.107 | 0.33 | 0.06 | 0.003 | 0.035 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55 | 0.107 | 0.33 | 0.06 | 0.003 | 0.035 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7 | 0.107 | 0.33 | 0.05 | 0.003 | 0.043 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55 | 0.107 | 0.33 | 0.06 | 0.003 | 0.033 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7 | 0.107 | 0.33 | 0.05 | 0.003 | 0.043 |
| estimated (priors ×0.25), direct effects, fade 1/1/1/0.55 | 0.106 | 0.33 | 0.057 | 0.003 | 0.035 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7 | 0.106 | 0.33 | 0.048 | 0.003 | 0.043 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7 | 0.106 | 0.33 | 0.048 | 0.003 | 0.043 |
| estimated (priors ×1), direct effects, fade 1/1/1/0.4 | 0.105 | 0.33 | 0.055 | 0.003 | 0.033 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/1/0.55 | 0.105 | 0.33 | 0.053 | 0.003 | 0.035 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.55 | 0.105 | 0.33 | 0.053 | 0.003 | 0.035 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/1/0.55 | 0.105 | 0.33 | 0.055 | 0.003 | 0.033 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.55 | 0.105 | 0.33 | 0.053 | 0.003 | 0.033 |
| estimated (priors ×2), direct effects, fade 1/1/1/0.55 | 0.102 | 0.33 | 0.05 | 0 | 0.028 |
| hand-set, direct effects, fade 1/1/1/0.4 | 0.101 | 0.32 | 0.053 | 0.003 | 0.028 |
| hand-set, 2 rounds, fade 1/1/1/0.55 | 0.094 | 0.27 | 0.058 | 0.008 | 0.038 |
| hand-set, 3 rounds, fade 0.85/1/0.85/0.4 | 0.06 | 0.17 | 0.048 | 0.005 | 0.018 |

## Caveats

- Settings chosen on the same quarters they are scored on flatter them a little; the two halves show whether the choice holds.
- Deal figures in weak sector-years (2019–2020 and a few earlier) can't be scored, so deal results lean on 2021 onward.
- Quarterly deal and IPO counts are noisy: most of their movement is not explained by macro or market moves, so skill stays small even when the direction is right.
