"""
Backtest inputs for the ripple engine. `npm run backtest` runs this, then ingest/backtest.ts scores the engine.

For every quarter t from BACKTEST_FROM on, the links are re-estimated using only what was known before t: the quarters
before it, ETF months before it and IO tables up to the year before. That is done once per prior scale (how far the
estimates may move from the hand-set values), so the TypeScript side can compare them out of sample.

Writes .data/history/backtest_input.json:
    panel       per sector-quarter: valuation, deal count, deal value, IPO count (log changes x 100, as in the estimator)
                and the macro changes in the engine's units (pp; VIX points)
    estimates   {prior scale: {origin quarter: estimated.json-shaped link estimates}}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import estimate_links as E  # noqa: E402

BACKTEST_FROM = 2019 * 4  # 2019Q1: four years of history to learn from
# Prior width multipliers ("0.5" = every link kind; "f0.25/s0.5/m1" = feature / sector / macro links separately).
UNIFORM = ["0.25", "0.5", "0.75", "1", "2"]
PER_KIND = [f"f{f}/s{s}/m{m}" for f in ("0.25", "0.5") for s in ("0.5", "1") for m in ("0.5", "1", "2") if not (f == s == m)]
PRIOR_SCALES = UNIFORM + PER_KIND
L_BOOT = 100  # bootstrap runs for the sector links' shrinkage weights (their ranges aren't scored)
OUT = E.HIST / "backtest_input.json"


def month_of(qi: int) -> str:
    return f"{qi // 4}-{(qi % 4) * 3 + 1:02d}"


def num(v) -> float | None:
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), 4)


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Backtest inputs: links re-estimated at every quarter with only earlier data.")
    ap.add_argument("--deal-value", choices=["total", "capped"], default=E.DEAL_VALUE, help="deal-value series the links are estimated on")
    ap.add_argument("--winsor", type=float, default=E.WINSOR[0], help="clip deal and IPO growth at this percentile (and 100 minus it) for estimation")
    ap.add_argument("--scales", default=",".join(PRIOR_SCALES), help="prior width labels to estimate, comma-separated")
    ap.add_argument("--macro", choices=["average", "end"], default=E.MACRO_TIMING, help="macro changes between quarter averages or quarter-end months")
    ap.add_argument("--exclude", default=",".join(E.EXCLUDE_QUARTERS), help="quarters left out of the estimation, e.g. 2020Q1,2020Q2,2020Q3")
    ap.add_argument("--half-life", type=float, default=E.HALF_LIFE, help="recency weighting: weight halves every N years back")
    ap.add_argument("--sector-features", choices=["on", "off"], default="on" if E.SECTOR_FEATURES else "off", help="sector-specific valuation → deal / IPO links where an F-test supports them")
    ap.add_argument("--out", default=str(OUT), help="where to write the inputs")
    args = ap.parse_args()
    E.HALF_LIFE = args.half_life
    E.SECTOR_FEATURES = args.sector_features == "on"

    handset = E.load_json("handset_links.json")
    # What the engine is scored against stays fixed (total deal values, standard clipping) whatever the estimation uses.
    scored, _, _ = E.build_panel(deal_value="total", winsor=E.WINSOR, macro_timing=args.macro)
    panel, sm_rows, info = E.build_panel(deal_value=args.deal_value, winsor=(args.winsor, 100 - args.winsor), macro_timing=args.macro)
    exclude = [q for q in args.exclude.split(",") if q]
    quarters = sorted(int(q) for q in panel["qi"].unique())
    origins = [q for q in quarters if q >= BACKTEST_FROM]
    rows = [
        {
            "sector": r.sector, "qi": int(r.qi), "quarter": E.quarter_label(int(r.qi)),
            **{f: num(getattr(r, f)) for f in E.FEATURES},
            **{m: num(getattr(r, m) * E.MACRO_UNIT[m]) if getattr(r, m) == getattr(r, m) else None for m in E.MACROS},
        }
        for r in scored.itertuples()
    ]
    out = {"origins": [E.quarter_label(q) for q in origins], "ipoHistory": info["ipoOk"], "panel": rows, "estimates": {},
           "estimation": {"dealValue": args.deal_value, "winsor": args.winsor, "macro": args.macro, "exclude": exclude}}
    for scale in args.scales.split(","):
        per_origin = {}
        for t in origins:
            rng = np.random.default_rng(E.SEED + t)
            train = panel[panel["qi"] < t]
            eqs = {}
            for f in E.FEATURES:
                eq = E.estimate_equation(train, f, handset, rng, n_boot=0, prior_scale=scale, exclude=exclude)
                if eq is not None:
                    eqs[f] = eq
            sector_links, _ = E.estimate_sector_links(sm_rows, handset, rng, n_boot=L_BOOT, prior_scale=scale, before_month=month_of(t))
            links, _ = E.collect(eqs, sector_links, handset, info)
            per_origin[E.quarter_label(t)] = {
                "meta": {"generatedAt": "", "window": {"from": info["quarters"][0], "to": E.quarter_label(t - 1), "quarters": len([q for q in quarters if q < t])},
                         "ipoHistory": info["ipoOk"], "enoughData": E.ENOUGH_DATA, "bootstrapRuns": 0},
                "features": links["features"], "sectors": links["sectors"], "macro": links["macro"],
            }
        out["estimates"][str(scale)] = per_origin
        E.log(f"  prior scale {scale}: links re-estimated at {len(origins)} quarters ({out['origins'][0]}–{out['origins'][-1]})")
    path = Path(args.out)
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8", newline="\n")
    E.log(f"wrote {path}")


if __name__ == "__main__":
    main()
