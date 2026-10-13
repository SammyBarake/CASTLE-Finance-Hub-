# Ripple engine backtest

Generated 2026-10-13T19:36:33Z by `ingest/backtest.ts` (`npm run backtest`). Do not edit by hand.

## How it works

At each of 31 quarters (2019Q1 to 2026Q3) the links are re-estimated using only earlier data. The engine gets that quarter's real macro changes and sector ETF moves (less the part it already puts down to the macro changes), and those of the 2 quarters before (their effects are still rippling through the lagged links; only their part still to come counts), and predicts the next 4 quarters.

Feeding the earlier quarters' shocks: direction 61% → 64%, skill 0.12 → 0.163 (best setup with this quarter's shocks only: estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/0.85/0.7, this quarter's shocks).

Deal and IPO outcomes are measured against the average of the four quarters before (plus trend), with the calendar pattern taken out (deals dip in Q1, IPOs bunch in Q2; measured from earlier quarters only); valuations against the quarter before. Ideas tried to improve on this, kept or rejected, are in `research/experiments.md`.

- **Skill**: 1 − squared error ÷ squared error of predicting "no change from trend". Above 0 beats it; 1 would be perfect.
- **Direction**: share of predicted moves (0.5 points or more) with the right sign. A coin flip scores 50%.
- **Slope**: what happened regressed on what was predicted. 1 = effects sized right; below 1 = overstated.

## Chosen settings

**estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.85/0.7, plus the last 2 quarters' shocks**. Average skill 0.163 (previous settings 0.087, hand-set links 0.089, no links 0.084). Direction right 64% of the time overall, 61% for deals and IPOs.

| Period | Chosen | Previous | Hand-set |
|---|---|---|---|
| 2019Q1–2022Q4 | 0.212 | 0.105 | 0.102 |
| 2023Q1–2026Q3 | 0.098 | 0.06 | 0.066 |

## By feature and quarter ahead (chosen settings)

| Feature | Q | n | Skill | Direction | Slope |
|---|---|---|---|---|---|
| Valuation | Q2 | 150 | 0.370 | 72% | 0.76 |
| Valuation | Q3 | 145 | 0.360 | 72% | 0.91 |
| Valuation | Q4 | 140 | 0.260 | 67% | 0.89 |
| Deal count | Q1 | 111 | 0.050 | 54% | 0.68 |
| Deal count | Q2 | 102 | 0.210 | 69% | 1.02 |
| Deal count | Q3 | 93 | 0.240 | 65% | 1.09 |
| Deal count | Q4 | 84 | 0.200 | 67% | 1.03 |
| Deal value | Q1 | 111 | 0.020 | 55% | 0.77 |
| Deal value | Q2 | 102 | -0.010 | 52% | 0.37 |
| Deal value | Q3 | 93 | 0.010 | 57% | 0.63 |
| Deal value | Q4 | 84 | 0.020 | 61% | 0.78 |
| IPO count | Q1 | 155 | 0.190 | 63% | 1.31 |
| IPO count | Q2 | 150 | 0.220 | 68% | 1.32 |
| IPO count | Q3 | 145 | 0.080 | 65% | 0.97 |
| IPO count | Q4 | 140 | 0.050 | 60% | 1.27 |

## Every setup tried

Fade per feature: valuation / deal count / deal value / IPO count.

| Setup | Score | Valuation | Deal count | Deal value | IPO count |
|---|---|---|---|---|---|
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.85/0.7, plus the last 2 quarters' shocks | 0.163 | 0.33 | 0.175 | 0.01 | 0.135 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.162 | 0.327 | 0.173 | 0.013 | 0.135 |
| estimated (priors ×0.25), 3 rounds, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.161 | 0.327 | 0.165 | 0.018 | 0.133 |
| estimated (priors ×0.25), 2 rounds, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.16 | 0.327 | 0.167 | 0.018 | 0.128 |
| estimated (priors ×0.5), 3 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.16 | 0.32 | 0.167 | 0.013 | 0.138 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/0.85/0.7, plus the last 2 quarters' shocks | 0.16 | 0.33 | 0.168 | 0.008 | 0.135 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last 2 quarters' shocks | 0.16 | 0.33 | 0.168 | 0.005 | 0.138 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.16 | 0.32 | 0.17 | 0.01 | 0.14 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.159 | 0.33 | 0.165 | 0.008 | 0.133 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.159 | 0.327 | 0.167 | 0.005 | 0.135 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.158 | 0.33 | 0.16 | 0.005 | 0.135 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.158 | 0.323 | 0.16 | 0.005 | 0.143 |
| estimated (priors ×0.5), 2 rounds, fade 1/1/0.85/0.7, plus the last 2 quarters' shocks | 0.157 | 0.33 | 0.158 | 0.008 | 0.133 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.157 | 0.33 | 0.148 | 0.013 | 0.135 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last 2 quarters' shocks | 0.157 | 0.33 | 0.158 | 0.003 | 0.138 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/0.85/0.7, plus the last 2 quarters' shocks | 0.157 | 0.33 | 0.16 | -0.002 | 0.14 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.157 | 0.32 | 0.16 | 0.008 | 0.14 |
| estimated (priors ×0.75), 3 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.156 | 0.317 | 0.155 | 0.01 | 0.143 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.155 | 0.33 | 0.145 | 0.013 | 0.13 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.155 | 0.327 | 0.143 | 0.013 | 0.135 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.154 | 0.327 | 0.155 | -0.002 | 0.135 |
| estimated (priors ×0.25), 3 rounds, fade 1/1/0.85/0.85, plus the last quarter's shocks | 0.154 | 0.327 | 0.143 | 0.017 | 0.13 |
| estimated (priors ×0.5), 3 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.154 | 0.323 | 0.14 | 0.013 | 0.138 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.154 | 0.323 | 0.148 | 0 | 0.145 |
| estimated (priors ×0.25), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.153 | 0.327 | 0.14 | 0.013 | 0.13 |
| estimated (priors ×0.75), 2 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.153 | 0.33 | 0.143 | 0 | 0.138 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.153 | 0.327 | 0.15 | 0 | 0.135 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.153 | 0.33 | 0.148 | 0 | 0.135 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.153 | 0.33 | 0.145 | -0.002 | 0.138 |
| estimated (priors ×1), 3 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.153 | 0.317 | 0.14 | 0.008 | 0.145 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.153 | 0.323 | 0.14 | 0.005 | 0.145 |
| estimated (priors ×0.5), 2 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.152 | 0.33 | 0.135 | 0.008 | 0.133 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.152 | 0.327 | 0.138 | 0.008 | 0.133 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.152 | 0.33 | 0.138 | 0.01 | 0.13 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.152 | 0.327 | 0.138 | 0.01 | 0.133 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.152 | 0.327 | 0.138 | 0.01 | 0.133 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.152 | 0.327 | 0.138 | 0.01 | 0.133 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.151 | 0.327 | 0.14 | 0.005 | 0.133 |
| estimated (priors ×0.75), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.151 | 0.323 | 0.133 | 0.013 | 0.135 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.15 | 0.327 | 0.135 | 0.005 | 0.133 |
| estimated (priors ×1), 3 rounds, fade 1/1/0.7/0.55, plus the last quarter's shocks | 0.15 | 0.323 | 0.128 | 0.01 | 0.138 |
| estimated (priors ×1), 2 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.149 | 0.33 | 0.128 | -0.002 | 0.138 |
| estimated (priors ×0.75), 2 rounds, fade 1/1/1/0.7, plus the last quarter's shocks | 0.148 | 0.327 | 0.128 | 0.003 | 0.133 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.147 | 0.327 | 0.123 | 0.003 | 0.133 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/0.4/0.55, plus the last 2 quarters' shocks | 0.147 | 0.33 | 0.12 | -0.007 | 0.143 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/0.55/0.7, plus the last quarter's shocks | 0.147 | 0.327 | 0.123 | 0.005 | 0.133 |
| estimated (priors ×0.25), direct effects, fade 1/1/1/0.7, plus the last 2 quarters' shocks | 0.146 | 0.33 | 0.123 | 0.015 | 0.115 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.146 | 0.323 | 0.128 | 0.003 | 0.13 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.146 | 0.327 | 0.125 | 0 | 0.133 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/0.85/0.55, plus the last 2 quarters' shocks | 0.146 | 0.323 | 0.128 | -0.007 | 0.14 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.146 | 0.327 | 0.123 | -0.01 | 0.143 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.146 | 0.33 | 0.12 | 0.005 | 0.13 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.146 | 0.327 | 0.118 | 0.005 | 0.133 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.145 | 0.323 | 0.128 | 0 | 0.13 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.145 | 0.323 | 0.128 | -0.01 | 0.14 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/0.7/0.7, plus the last quarter's shocks | 0.145 | 0.327 | 0.11 | 0.008 | 0.133 |
| estimated (priors ×1), 2 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.143 | 0.323 | 0.115 | 0 | 0.135 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.142 | 0.33 | 0.115 | 0.005 | 0.118 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.142 | 0.33 | 0.113 | 0.005 | 0.12 |
| estimated (priors ×0.5), direct effects, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.141 | 0.33 | 0.11 | 0.005 | 0.12 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.141 | 0.33 | 0.113 | 0.005 | 0.115 |
| estimated (priors ×0.25), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.14 | 0.33 | 0.105 | 0.005 | 0.12 |
| estimated (priors ×0.5), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.139 | 0.33 | 0.1 | 0.003 | 0.123 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.139 | 0.33 | 0.1 | 0.003 | 0.123 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/0.4/0.7, plus the last quarter's shocks | 0.139 | 0.323 | 0.105 | -0.002 | 0.13 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/0.4/0.55, plus the last quarter's shocks | 0.139 | 0.323 | 0.103 | -0.005 | 0.133 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/0.55/0.55, plus the last quarter's shocks | 0.139 | 0.327 | 0.098 | -0.002 | 0.133 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/0.4/0.7, plus the last quarter's shocks | 0.139 | 0.323 | 0.1 | -0.002 | 0.133 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.138 | 0.33 | 0.098 | 0.003 | 0.12 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.138 | 0.33 | 0.098 | 0.003 | 0.12 |
| estimated (priors ×0.75), direct effects, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.137 | 0.33 | 0.095 | 0 | 0.123 |
| estimated (priors ×2), 3 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.137 | 0.313 | 0.09 | 0 | 0.145 |
| hand-set, direct effects, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.136 | 0.32 | 0.108 | 0.015 | 0.1 |
| estimated (priors ×0.75), direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.135 | 0.33 | 0.09 | -0.002 | 0.12 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/0.7/0.85, plus the last 2 quarters' shocks | 0.134 | 0.33 | 0.088 | -0.002 | 0.12 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/0.7/0.85, plus the last 2 quarters' shocks | 0.134 | 0.33 | 0.088 | -0.002 | 0.12 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.134 | 0.33 | 0.088 | -0.005 | 0.123 |
| estimated (priors ×2), 3 rounds, fade 1/1/0.55/0.55, plus the last quarter's shocks | 0.134 | 0.317 | 0.08 | 0.002 | 0.135 |
| estimated (priors ×1), direct effects, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.133 | 0.33 | 0.083 | -0.005 | 0.123 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.133 | 0.33 | 0.088 | -0.005 | 0.12 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/0.7/1, plus the last quarter's shocks | 0.132 | 0.33 | 0.08 | -0.002 | 0.118 |
| estimated (priors ×2), 2 rounds, fade 1/1/0.7/0.55, plus the last 2 quarters' shocks | 0.132 | 0.323 | 0.07 | -0.005 | 0.14 |
| estimated (priors ×1), direct effects, fade 1/1/0.4/0.85, plus the last quarter's shocks | 0.131 | 0.33 | 0.078 | -0.002 | 0.118 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/0.7/1, plus the last quarter's shocks | 0.131 | 0.33 | 0.08 | -0.002 | 0.115 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/0.55/0.85, plus the last quarter's shocks | 0.131 | 0.33 | 0.078 | -0.002 | 0.118 |
| hand-set, direct effects, fade 1/1/1/0.85, plus the last quarter's shocks | 0.13 | 0.32 | 0.09 | 0.008 | 0.1 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/0.7/1, plus the last quarter's shocks | 0.13 | 0.33 | 0.078 | -0.002 | 0.115 |
| estimated (priors ×2), 2 rounds, fade 1/1/0.55/0.55, plus the last quarter's shocks | 0.13 | 0.317 | 0.07 | 0 | 0.133 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/0.85/0.4/0.85, plus the last 2 quarters' shocks | 0.122 | 0.33 | 0.04 | -0.007 | 0.125 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/0.4/0.85, plus the last quarter's shocks | 0.121 | 0.33 | 0.04 | -0.002 | 0.115 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/0.4/0.85, plus the last quarter's shocks | 0.121 | 0.33 | 0.04 | -0.002 | 0.115 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/0.4/0.85, plus the last quarter's shocks | 0.121 | 0.33 | 0.04 | -0.002 | 0.115 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/0.4/0.85, plus the last 2 quarters' shocks | 0.121 | 0.33 | 0.038 | -0.007 | 0.123 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/0.85/0.85, plus the last 2 quarters' shocks | 0.121 | 0.33 | 0.042 | -0.01 | 0.123 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/0.7/0.85, plus the last 2 quarters' shocks | 0.121 | 0.33 | 0.042 | -0.01 | 0.123 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/0.4/0.85, plus the last quarter's shocks | 0.12 | 0.33 | 0.04 | -0.002 | 0.113 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/0.85/0.7, this quarter's shocks | 0.12 | 0.333 | 0.09 | -0.002 | 0.057 |
| estimated (priors ×2), direct effects, fade 1/1/0.55/0.85, plus the last 2 quarters' shocks | 0.119 | 0.33 | 0.035 | -0.015 | 0.125 |
| estimated (priors ×0.5), 3 rounds, fade 0.85/1/1/0.7, this quarter's shocks | 0.119 | 0.333 | 0.083 | -0.002 | 0.06 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 3 rounds, fade 0.85/1/0.85/0.55, this quarter's shocks | 0.119 | 0.333 | 0.083 | -0.002 | 0.06 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 3 rounds, fade 0.85/1/0.7/0.55, this quarter's shocks | 0.119 | 0.333 | 0.08 | -0.002 | 0.063 |
| estimated (priors ×0.25), 2 rounds, fade 1/1/0.85/0.7, this quarter's shocks | 0.118 | 0.33 | 0.083 | 0 | 0.057 |
| estimated (priors ×0.5), 2 rounds, fade 0.85/1/0.7/0.55, this quarter's shocks | 0.118 | 0.333 | 0.08 | -0.002 | 0.06 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 1/1/0.7/0.55, this quarter's shocks | 0.118 | 0.33 | 0.085 | -0.002 | 0.057 |
| estimated (priors ×0.25), 3 rounds, fade 0.85/1/0.85/0.7, this quarter's shocks | 0.118 | 0.33 | 0.085 | 0 | 0.057 |
| estimated (priors ×0.75), 3 rounds, fade 0.85/1/0.85/0.55, this quarter's shocks | 0.118 | 0.333 | 0.08 | -0.002 | 0.06 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 3 rounds, fade 1/1/0.85/0.7, this quarter's shocks | 0.118 | 0.33 | 0.088 | -0.002 | 0.057 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 1/1/0.7/0.55, this quarter's shocks | 0.118 | 0.33 | 0.082 | -0.002 | 0.063 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 3 rounds, fade 1/1/0.7/0.55, this quarter's shocks | 0.118 | 0.33 | 0.082 | -0.002 | 0.06 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 3 rounds, fade 0.85/1/0.85/0.55, this quarter's shocks | 0.118 | 0.333 | 0.078 | -0.002 | 0.063 |
| estimated (priors ×2), direct effects, fade 1/1/0.55/0.85, plus the last quarter's shocks | 0.117 | 0.33 | 0.04 | -0.012 | 0.11 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), 2 rounds, fade 1/1/0.7/0.55, this quarter's shocks | 0.117 | 0.33 | 0.083 | -0.002 | 0.057 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), 2 rounds, fade 0.85/1/0.85/0.7, this quarter's shocks | 0.117 | 0.333 | 0.08 | -0.002 | 0.057 |
| estimated (priors ×0.75), 2 rounds, fade 0.85/1/0.55/0.55, this quarter's shocks | 0.115 | 0.333 | 0.073 | -0.002 | 0.057 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 1/1/0.7/0.7, this quarter's shocks | 0.115 | 0.33 | 0.075 | -0.005 | 0.06 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), 2 rounds, fade 0.85/1/0.85/0.55, this quarter's shocks | 0.115 | 0.33 | 0.073 | -0.005 | 0.063 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), 2 rounds, fade 0.85/1/0.7/0.55, this quarter's shocks | 0.115 | 0.33 | 0.075 | -0.005 | 0.06 |
| estimated (priors ×1), 3 rounds, fade 0.85/1/0.85/0.55, this quarter's shocks | 0.115 | 0.333 | 0.07 | -0.002 | 0.06 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 0.85/1/0.55/0.55, this quarter's shocks | 0.115 | 0.333 | 0.063 | -0.002 | 0.065 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 3 rounds, fade 0.85/1/0.55/0.55, this quarter's shocks | 0.115 | 0.333 | 0.065 | -0.002 | 0.065 |
| estimated (priors ×1), 2 rounds, fade 0.85/1/0.85/0.55, this quarter's shocks | 0.114 | 0.333 | 0.068 | -0.005 | 0.06 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), 2 rounds, fade 1/1/0.7/0.7, this quarter's shocks | 0.114 | 0.327 | 0.078 | -0.005 | 0.057 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 3 rounds, fade 1/1/0.55/0.7, this quarter's shocks | 0.114 | 0.33 | 0.065 | -0.002 | 0.063 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 3 rounds, fade 1/1/0.4/0.55, this quarter's shocks | 0.114 | 0.327 | 0.068 | -0.002 | 0.063 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 1/1/0.4/0.55, this quarter's shocks | 0.111 | 0.33 | 0.057 | -0.005 | 0.063 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), 2 rounds, fade 0.85/1/0.55/0.55, this quarter's shocks | 0.111 | 0.327 | 0.055 | -0.005 | 0.065 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), 2 rounds, fade 1/1/0.4/0.55, this quarter's shocks | 0.11 | 0.327 | 0.055 | -0.005 | 0.063 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), 2 rounds, fade 0.85/1/0.4/0.55, this quarter's shocks | 0.11 | 0.327 | 0.053 | -0.005 | 0.063 |
| estimated (priors ×0.25), direct effects, fade 1/1/1/0.85, this quarter's shocks | 0.109 | 0.33 | 0.063 | -0.002 | 0.045 |
| estimated (priors ×2), 3 rounds, fade 0.85/1/0.55/0.4, this quarter's shocks | 0.109 | 0.333 | 0.048 | -0.005 | 0.06 |
| estimated (priors ×0.5), direct effects, fade 1/1/0.85/0.7, this quarter's shocks | 0.108 | 0.33 | 0.06 | -0.002 | 0.042 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×0.5 macro), direct effects, fade 1/1/0.85/0.7, this quarter's shocks | 0.108 | 0.33 | 0.058 | -0.002 | 0.045 |
| estimated (priors ×0.25 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/0.85/0.7, this quarter's shocks | 0.108 | 0.33 | 0.058 | -0.002 | 0.045 |
| estimated (priors ×0.5 links, ×1 spillovers, ×0.5 macro), direct effects, fade 1/1/0.85/0.7, this quarter's shocks | 0.108 | 0.33 | 0.06 | -0.002 | 0.042 |
| hand-set, 2 rounds, fade 1/1/1/0.55, plus the last 2 quarters' shocks | 0.107 | 0.16 | 0.128 | 0.02 | 0.118 |
| estimated (priors ×1), direct effects, fade 1/1/0.55/0.55, this quarter's shocks | 0.105 | 0.33 | 0.053 | -0.002 | 0.038 |
| estimated (priors ×0.75), direct effects, fade 1/1/0.7/0.7, this quarter's shocks | 0.105 | 0.33 | 0.053 | -0.002 | 0.04 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/0.7/0.7, this quarter's shocks | 0.105 | 0.33 | 0.05 | -0.002 | 0.04 |
| estimated (priors ×2), 2 rounds, fade 0.85/1/0.7/0.55, this quarter's shocks | 0.105 | 0.327 | 0.043 | -0.005 | 0.055 |
| estimated (priors ×0.25 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/0.7/0.7, this quarter's shocks | 0.104 | 0.33 | 0.05 | -0.002 | 0.038 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×1 macro), direct effects, fade 1/1/0.7/0.7, this quarter's shocks | 0.104 | 0.33 | 0.048 | -0.002 | 0.04 |
| estimated (priors ×0.5 links, ×1 spillovers, ×1 macro), direct effects, fade 1/1/0.7/0.55, this quarter's shocks | 0.104 | 0.33 | 0.05 | -0.002 | 0.038 |
| hand-set, 2 rounds, fade 1/1/0.85/0.7, plus the last quarter's shocks | 0.104 | 0.177 | 0.105 | 0.013 | 0.12 |
| hand-set, direct effects, fade 1/1/0.4/0.4, this quarter's shocks | 0.103 | 0.32 | 0.055 | 0 | 0.038 |
| estimated (priors ×0.5 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/0.55/0.55, this quarter's shocks | 0.099 | 0.33 | 0.028 | -0.002 | 0.038 |
| estimated (priors ×0.25 links, ×0.5 spillovers, ×2 macro), direct effects, fade 1/1/0.55/0.55, this quarter's shocks | 0.098 | 0.33 | 0.025 | -0.002 | 0.038 |
| estimated (priors ×0.25 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/0.55/0.55, this quarter's shocks | 0.098 | 0.33 | 0.025 | -0.002 | 0.038 |
| estimated (priors ×0.5 links, ×1 spillovers, ×2 macro), direct effects, fade 1/1/0.55/0.7, this quarter's shocks | 0.098 | 0.33 | 0.028 | -0.002 | 0.037 |
| estimated (priors ×2), direct effects, fade 1/1/0.4/0.4, this quarter's shocks | 0.096 | 0.33 | 0.03 | -0.007 | 0.03 |
| hand-set, 2 rounds, fade 1/1/0.85/0.7, this quarter's shocks | 0.095 | 0.27 | 0.063 | -0.002 | 0.048 |
| hand-set, 3 rounds, fade 1/1/0.85/0.85, plus the last quarter's shocks | 0.063 | 0.067 | 0.08 | 0.003 | 0.1 |
| hand-set, 3 rounds, fade 0.85/1/0.7/0.55, this quarter's shocks | 0.06 | 0.17 | 0.05 | -0.007 | 0.028 |
| hand-set, 3 rounds, fade 1/1/1/0.85, plus the last 2 quarters' shocks | 0.055 | 0.017 | 0.098 | 0.003 | 0.1 |

## Caveats

- Settings chosen on the same quarters they are scored on flatter them a little; the two halves show whether the choice holds.
- Deal figures in weak coverage years (2010–2011, 2020 and a few sector-years) are left out of the estimation and can't be scored.
- Quarterly deal and IPO counts are noisy: most of their movement is not explained by macro or market moves, so skill stays small even when the direction is right.
