# Ripple engine backtest

Generated 2026-10-07T03:03:42Z by `ingest/backtest.ts` (`npm run backtest`). Do not edit by hand.

## How it works

At each of 31 quarters (2019Q1 to 2026Q3) the links are re-estimated using only earlier data. The engine gets that quarter's real macro changes and sector ETF moves (less the part it already puts down to the macro changes), and those of the 2 quarters before (their effects are still rippling through the lagged links; only their part still to come counts), and predicts the next 4 quarters.

Feeding the earlier quarters' shocks: direction 60% → 65%, skill 0.119 → 0.164 (best setup with this quarter's shocks only: estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/1/0.55, this quarter's shocks).

Deal and IPO outcomes are measured against the average of the four quarters before (plus trend), with the calendar pattern taken out (deals dip in Q1, IPOs bunch in Q2; measured from earlier quarters only); valuations against the quarter before. Ideas tried to improve on this, kept or rejected, are in `research/experiments.md`.

- **Skill**: 1 − squared error ÷ squared error of predicting "no change from trend". Above 0 beats it; 1 would be perfect.
- **Direction**: share of predicted moves (0.5 points or more) with the right sign. A coin flip scores 50%.
- **Slope**: what happened regressed on what was predicted. 1 = effects sized right; below 1 = overstated.

## Chosen settings

**estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks**. Average skill 0.164 (previous settings 0.088, hand-set links 0.087, no links 0.084). Direction right 65% of the time overall, 63% for deals and IPOs.

| Period | Chosen | Previous | Hand-set |
|---|---|---|---|
| 2019Q1–2022Q4 | 0.24 | 0.105 | 0.099 |
| 2023Q1–2026Q3 | 0.058 | 0.059 | 0.061 |

## By feature and quarter ahead (chosen settings)

| Feature | Q | n | Skill | Direction | Slope |
|---|---|---|---|---|---|
| Valuation | Q2 | 150 | 0.380 | 74% | 0.77 |
| Valuation | Q3 | 145 | 0.370 | 73% | 0.94 |
| Valuation | Q4 | 140 | 0.260 | 68% | 0.93 |
| Deal count | Q1 | 111 | 0.070 | 56% | 0.78 |
| Deal count | Q2 | 102 | 0.200 | 64% | 1.04 |
| Deal count | Q3 | 93 | 0.220 | 66% | 1.13 |
| Deal count | Q4 | 84 | 0.170 | 69% | 0.98 |
| Deal value | Q1 | 111 | 0.040 | 65% | 1.29 |
| Deal value | Q2 | 102 | 0.030 | 60% | 0.86 |
| Deal value | Q3 | 93 | 0.040 | 55% | 1.03 |
| Deal value | Q4 | 84 | 0.060 | 64% | 1.32 |
| IPO count | Q1 | 155 | 0.180 | 66% | 1.48 |
| IPO count | Q2 | 150 | 0.190 | 68% | 1.47 |
| IPO count | Q3 | 145 | 0.050 | 62% | 1.05 |
| IPO count | Q4 | 140 | 0.030 | 60% | 1.72 |

## Every setup tried

Fade per feature: valuation / deal count / deal value / IPO count.

| Setup | Score | Valuation | Deal count | Deal value | IPO count |
|---|---|---|---|---|---|
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.164 | 0.337 | 0.165 | 0.043 | 0.112 |
| estimated (priors ×0.25), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.163 | 0.333 | 0.16 | 0.05 | 0.11 |
| estimated (priors ×0.5), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.163 | 0.323 | 0.165 | 0.05 | 0.112 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.163 | 0.337 | 0.158 | 0.043 | 0.112 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.163 | 0.333 | 0.163 | 0.043 | 0.112 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.163 | 0.33 | 0.16 | 0.045 | 0.115 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.163 | 0.33 | 0.163 | 0.045 | 0.113 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.162 | 0.337 | 0.153 | 0.04 | 0.118 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.162 | 0.333 | 0.163 | 0.038 | 0.112 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.162 | 0.33 | 0.15 | 0.043 | 0.123 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.162 | 0.33 | 0.155 | 0.04 | 0.123 |
| estimated (priors ×1), 3 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.161 | 0.32 | 0.163 | 0.045 | 0.115 |
| estimated (priors ×0.75), 3 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.161 | 0.32 | 0.163 | 0.045 | 0.115 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.161 | 0.337 | 0.155 | 0.035 | 0.118 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.161 | 0.323 | 0.165 | 0.045 | 0.112 |
| estimated (priors ×0.5), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.16 | 0.33 | 0.16 | 0.038 | 0.11 |
| estimated (priors ×0.25), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.159 | 0.327 | 0.158 | 0.043 | 0.107 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.159 | 0.33 | 0.16 | 0.035 | 0.112 |
| estimated (priors ×0.75), 2 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.158 | 0.33 | 0.158 | 0.035 | 0.11 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.158 | 0.327 | 0.16 | 0.035 | 0.11 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.158 | 0.33 | 0.155 | 0.035 | 0.113 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.158 | 0.33 | 0.155 | 0.033 | 0.113 |
| estimated (priors ×1), 2 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.157 | 0.33 | 0.153 | 0.033 | 0.11 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.157 | 0.327 | 0.158 | 0.033 | 0.11 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.156 | 0.327 | 0.153 | 0.033 | 0.112 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.156 | 0.327 | 0.153 | 0.033 | 0.112 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.155 | 0.33 | 0.14 | 0.03 | 0.118 |
| estimated (priors ×0.25), 3 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.155 | 0.33 | 0.143 | 0.035 | 0.112 |
| estimated (priors ×0.5), 3 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.155 | 0.33 | 0.145 | 0.033 | 0.113 |
| estimated (priors ×0.75), 3 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.155 | 0.327 | 0.145 | 0.033 | 0.115 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.155 | 0.33 | 0.145 | 0.033 | 0.112 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.155 | 0.33 | 0.14 | 0.033 | 0.115 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.155 | 0.33 | 0.14 | 0.033 | 0.115 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.155 | 0.33 | 0.145 | 0.033 | 0.112 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.155 | 0.33 | 0.14 | 0.033 | 0.115 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.154 | 0.33 | 0.138 | 0.028 | 0.12 |
| estimated (priors ×1), 3 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.154 | 0.327 | 0.14 | 0.035 | 0.113 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.154 | 0.33 | 0.145 | 0.03 | 0.112 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.153 | 0.323 | 0.143 | 0.028 | 0.118 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.153 | 0.33 | 0.14 | 0.03 | 0.113 |
| estimated (priors ×2), 3 rounds, fade 1/1/0.85/0.4, plus the last 2 quarters' shocks | 0.153 | 0.32 | 0.145 | 0.04 | 0.105 |
| estimated (priors ×0.5), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.152 | 0.33 | 0.14 | 0.028 | 0.11 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.152 | 0.33 | 0.128 | 0.033 | 0.115 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.151 | 0.327 | 0.14 | 0.028 | 0.11 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.151 | 0.33 | 0.14 | 0.023 | 0.11 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.151 | 0.32 | 0.14 | 0.023 | 0.12 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/0.85/0.55, plus the last quarter's shocks | 0.151 | 0.33 | 0.128 | 0.03 | 0.115 |
| estimated (priors ×0.25), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.15 | 0.327 | 0.135 | 0.028 | 0.108 |
| estimated (priors ×0.75), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.15 | 0.33 | 0.135 | 0.025 | 0.11 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.15 | 0.327 | 0.133 | 0.025 | 0.113 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.15 | 0.327 | 0.138 | 0.023 | 0.11 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.15 | 0.33 | 0.133 | 0.025 | 0.113 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.15 | 0.327 | 0.128 | 0.03 | 0.113 |
| estimated (priors ×1), 2 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.149 | 0.33 | 0.133 | 0.023 | 0.11 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.149 | 0.33 | 0.13 | 0.023 | 0.113 |
| estimated (priors ×2), 2 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.149 | 0.33 | 0.138 | 0.023 | 0.103 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.149 | 0.327 | 0.128 | 0.028 | 0.113 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.148 | 0.323 | 0.133 | 0.023 | 0.113 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.146 | 0.33 | 0.12 | 0.02 | 0.115 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.145 | 0.323 | 0.123 | 0.02 | 0.115 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.145 | 0.323 | 0.123 | 0.018 | 0.115 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, plus the last quarter's shocks | 0.145 | 0.33 | 0.118 | 0.018 | 0.115 |
| estimated (priors ×2), 3 rounds, fade 1/1/0.85/0.4, plus the last quarter's shocks | 0.144 | 0.327 | 0.123 | 0.03 | 0.095 |
| estimated (priors ×0.25), direct effects, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.14 | 0.33 | 0.125 | 0.018 | 0.085 |
| estimated (priors ×2), 2 rounds, fade 1/1/1/0.4, plus the last quarter's shocks | 0.14 | 0.323 | 0.12 | 0.018 | 0.098 |
| estimated (priors ×0.5), direct effects, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.138 | 0.33 | 0.118 | 0.018 | 0.085 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.137 | 0.33 | 0.115 | 0.018 | 0.083 |
| estimated (priors ×0.25), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.136 | 0.33 | 0.11 | 0.013 | 0.09 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.136 | 0.33 | 0.115 | 0.015 | 0.083 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.136 | 0.33 | 0.115 | 0.015 | 0.085 |
| estimated (priors ×0.75), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.135 | 0.33 | 0.11 | 0.013 | 0.088 |
| estimated (priors ×0.5), direct effects, fade 1/1/1/0.7, plus the last quarter's shocks | 0.134 | 0.33 | 0.103 | 0.01 | 0.093 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.7, plus the last quarter's shocks | 0.134 | 0.33 | 0.103 | 0.01 | 0.093 |
| estimated (priors ×1), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.134 | 0.33 | 0.103 | 0.013 | 0.09 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.134 | 0.33 | 0.103 | 0.013 | 0.088 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.134 | 0.33 | 0.103 | 0.013 | 0.088 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.134 | 0.33 | 0.103 | 0.013 | 0.088 |
| estimated (priors ×0.75), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.133 | 0.33 | 0.1 | 0.01 | 0.093 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.133 | 0.33 | 0.1 | 0.01 | 0.093 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.133 | 0.33 | 0.1 | 0.01 | 0.09 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.133 | 0.33 | 0.093 | 0.01 | 0.098 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.133 | 0.33 | 0.095 | 0.01 | 0.098 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.133 | 0.33 | 0.1 | 0.013 | 0.088 |
| estimated (priors ×1), direct effects, fade 1/1/1/0.7, plus the last quarter's shocks | 0.132 | 0.33 | 0.093 | 0.008 | 0.095 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.132 | 0.33 | 0.093 | 0.008 | 0.095 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.131 | 0.33 | 0.09 | 0.008 | 0.095 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.131 | 0.33 | 0.078 | 0.008 | 0.108 |
| hand-set, direct effects, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.131 | 0.32 | 0.11 | 0.02 | 0.075 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.13 | 0.33 | 0.075 | 0.008 | 0.105 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.13 | 0.33 | 0.078 | 0.005 | 0.105 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.13 | 0.33 | 0.08 | 0.01 | 0.1 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.13 | 0.33 | 0.08 | 0.01 | 0.1 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.129 | 0.33 | 0.078 | 0.01 | 0.098 |
| estimated (priors ×2), direct effects, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.128 | 0.33 | 0.08 | 0.003 | 0.098 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.128 | 0.33 | 0.073 | 0.005 | 0.105 |
| estimated (priors ×2), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.128 | 0.33 | 0.08 | 0.005 | 0.095 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.128 | 0.33 | 0.075 | 0.01 | 0.098 |
| hand-set, direct effects, fade 1/1/1/0.7, plus the last quarter's shocks | 0.127 | 0.32 | 0.098 | 0.013 | 0.078 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/1/0.55, this quarter's shocks | 0.119 | 0.333 | 0.08 | 0.013 | 0.05 |
| estimated (priors ×0.5), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.118 | 0.33 | 0.08 | 0.01 | 0.053 |
| estimated (priors ×0.75), 3 rounds, fade 0.85/1/1/0.4, this quarter's shocks | 0.118 | 0.333 | 0.075 | 0.013 | 0.05 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.118 | 0.33 | 0.08 | 0.01 | 0.05 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.118 | 0.33 | 0.083 | 0.01 | 0.048 |
| estimated (priors ×0.5), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.073 | 0.01 | 0.053 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.075 | 0.01 | 0.053 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.075 | 0.01 | 0.053 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.073 | 0.01 | 0.053 |
| estimated (priors ×1), 3 rounds, fade 0.85/1/1/0.55, this quarter's shocks | 0.117 | 0.333 | 0.073 | 0.013 | 0.048 |
| estimated (priors ×0.25), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.078 | 0.013 | 0.048 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.078 | 0.01 | 0.05 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.078 | 0.01 | 0.05 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.075 | 0.01 | 0.053 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.117 | 0.33 | 0.078 | 0.01 | 0.05 |
| estimated (priors ×0.25), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.116 | 0.33 | 0.075 | 0.01 | 0.05 |
| estimated (priors ×0.75), 2 rounds, fade 1/1/1/0.4, this quarter's shocks | 0.116 | 0.33 | 0.073 | 0.01 | 0.05 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.116 | 0.33 | 0.075 | 0.01 | 0.048 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.116 | 0.33 | 0.073 | 0.01 | 0.05 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/0.85/0.55, this quarter's shocks | 0.116 | 0.33 | 0.07 | 0.01 | 0.053 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.116 | 0.33 | 0.07 | 0.01 | 0.053 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.116 | 0.33 | 0.07 | 0.01 | 0.053 |
| estimated (priors ×1), 2 rounds, fade 0.85/1/1/0.4, this quarter's shocks | 0.115 | 0.33 | 0.073 | 0.01 | 0.048 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/0.85/0.55, this quarter's shocks | 0.115 | 0.33 | 0.068 | 0.008 | 0.055 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.115 | 0.33 | 0.075 | 0.01 | 0.045 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.115 | 0.33 | 0.073 | 0.008 | 0.05 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.4, this quarter's shocks | 0.115 | 0.33 | 0.07 | 0.005 | 0.053 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.115 | 0.33 | 0.068 | 0.01 | 0.053 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.114 | 0.327 | 0.065 | 0.008 | 0.055 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.114 | 0.327 | 0.068 | 0.008 | 0.053 |
| estimated (priors ×2), 3 rounds, fade 0.85/1/1/0.4, this quarter's shocks | 0.112 | 0.333 | 0.065 | 0.01 | 0.038 |
| estimated (priors ×2), 2 rounds, fade 0.85/1/1/0.4, this quarter's shocks | 0.11 | 0.33 | 0.065 | 0.008 | 0.038 |
| estimated (priors ×0.5), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.107 | 0.33 | 0.06 | 0.003 | 0.033 |
| estimated (priors ×0.75), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.107 | 0.33 | 0.06 | 0.003 | 0.033 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.107 | 0.33 | 0.06 | 0.003 | 0.035 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.107 | 0.33 | 0.06 | 0.003 | 0.035 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7, this quarter's shocks | 0.107 | 0.33 | 0.05 | 0.003 | 0.043 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.107 | 0.33 | 0.06 | 0.003 | 0.033 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7, this quarter's shocks | 0.107 | 0.33 | 0.05 | 0.003 | 0.043 |
| estimated (priors ×0.25), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.106 | 0.33 | 0.057 | 0.003 | 0.035 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7, this quarter's shocks | 0.106 | 0.33 | 0.048 | 0.003 | 0.043 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/1/0.7, this quarter's shocks | 0.106 | 0.33 | 0.048 | 0.003 | 0.043 |
| estimated (priors ×1), direct effects, fade 1/1/1/0.4, this quarter's shocks | 0.105 | 0.33 | 0.055 | 0.003 | 0.033 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.105 | 0.33 | 0.053 | 0.003 | 0.035 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.105 | 0.33 | 0.053 | 0.003 | 0.035 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.105 | 0.33 | 0.055 | 0.003 | 0.033 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.105 | 0.33 | 0.053 | 0.003 | 0.033 |
| hand-set, 2 rounds, fade 1/1/1/0.4, plus the last 2 quarters' shocks | 0.104 | 0.16 | 0.118 | 0.043 | 0.093 |
| estimated (priors ×2), direct effects, fade 1/1/1/0.55, this quarter's shocks | 0.102 | 0.33 | 0.05 | 0 | 0.028 |
| hand-set, 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.102 | 0.177 | 0.105 | 0.03 | 0.095 |
| hand-set, direct effects, fade 1/1/1/0.4, this quarter's shocks | 0.101 | 0.32 | 0.053 | 0.003 | 0.028 |
| hand-set, 2 rounds, fade 1/1/1/0.55, this quarter's shocks | 0.094 | 0.27 | 0.058 | 0.008 | 0.038 |
| hand-set, 3 rounds, fade 1/1/1/0.85, plus the last quarter's shocks | 0.063 | 0.067 | 0.085 | 0.025 | 0.075 |
| hand-set, 3 rounds, fade 0.85/1/0.85/0.4, this quarter's shocks | 0.06 | 0.17 | 0.048 | 0.005 | 0.018 |
| hand-set, 3 rounds, fade 1/0.85/1/0.7, plus the last 2 quarters' shocks | 0.055 | 0.017 | 0.09 | 0.04 | 0.073 |

## Caveats

- Settings chosen on the same quarters they are scored on flatter them a little; the two halves show whether the choice holds.
- Deal figures in weak sector-years (2019–2020 and a few earlier) can't be scored, so deal results lean on 2021 onward.
- Quarterly deal and IPO counts are noisy: most of their movement is not explained by macro or market moves, so skill stays small even when the direction is right.
