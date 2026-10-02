/**
 * Which advisers a scenario favours: each bank's historical share of deal value by sector, times the engine's
 * predicted change in that sector's deal value. A bank concentrated where deal value is predicted to rise is
 * positioned to gain; one concentrated where it falls is exposed.
 *
 * Shares use league-table credit (every adviser on a deal, either side, is credited with its full value), so a
 * sector's shares add up to more than 100%. Terminated deals and deals with no disclosed value are left out.
 */
import { SECTORS, type Deal, type Sector } from "../types";
import type { RippleResult } from "./engine";

export interface AdviserShares {
  /** Window the shares cover (ISO dates, inclusive). */
  from: string;
  to: string;
  quarters: number;
  /** Total deal value per sector in the window. */
  sectorValueUsd: Record<Sector, number>;
  banks: { bank: string; valueUsd: Record<Sector, number>; share: Record<Sector, number> }[];
}

const emptySectors = () => Object.fromEntries(SECTORS.map((s) => [s, 0])) as Record<Sector, number>;

export function adviserShares(deals: Pick<Deal, "announcedDate" | "sector" | "status" | "valueUsd" | "acquirerAdvisors" | "targetAdvisors">[], from: string, to: string): AdviserShares {
  const inWindow = deals.filter((d) => d.announcedDate >= from && d.announcedDate <= to && d.status !== "Terminated" && d.valueUsd != null && d.valueUsd > 0);
  const sectorValueUsd = emptySectors();
  const byBank = new Map<string, Record<Sector, number>>();
  for (const d of inWindow) {
    sectorValueUsd[d.sector] += d.valueUsd!;
    for (const bank of new Set([...d.acquirerAdvisors, ...d.targetAdvisors])) {
      const v = byBank.get(bank) ?? emptySectors();
      v[d.sector] += d.valueUsd!;
      byBank.set(bank, v);
    }
  }
  const quarters = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / (91.31 * 86_400_000)));
  return {
    from,
    to,
    quarters,
    sectorValueUsd,
    banks: [...byBank].map(([bank, valueUsd]) => ({
      bank,
      valueUsd,
      share: Object.fromEntries(SECTORS.map((s) => [s, sectorValueUsd[s] ? valueUsd[s] / sectorValueUsd[s] : 0])) as Record<Sector, number>,
    })),
  };
}

export interface AdviserOutlook {
  bank: string;
  /** The bank's credited deal value over the same number of quarters at its historical pace. */
  baselineUsd: number;
  /** Predicted change in credited deal value over the scenario's quarters, with the engine's range. */
  changeUsd: { mid: number; low: number; high: number };
  /** Change relative to baseline, whole % (2.5 = 2.5%). */
  changePct: { mid: number; low: number; high: number };
  /** Sector where most of the change comes from. */
  driver: Sector | null;
}

/**
 * Per bank: Σ over sectors and quarters of share × the sector's average quarterly deal value × the predicted %
 * change in deal value that quarter. Banks are ranked by predicted change, largest gain first.
 */
export function adviserOutlook(result: RippleResult, shares: AdviserShares): AdviserOutlook[] {
  const perQuarter = (s: Sector) => shares.sectorValueUsd[s] / shares.quarters;
  const sectorChange = Object.fromEntries(
    SECTORS.map((s) => {
      const sum = (k: "mid" | "low" | "high") => result.quarters.reduce((t, q) => t + (perQuarter(s) * q.sectors[s].dealValue[k]) / 100, 0);
      return [s, { mid: sum("mid"), low: sum("low"), high: sum("high") }];
    }),
  ) as Record<Sector, { mid: number; low: number; high: number }>;
  const horizon = result.quarters.length;
  const r1 = (v: number) => Math.round(v * 10) / 10 + 0;
  return shares.banks
    .map((b) => {
      const baselineUsd = SECTORS.reduce((t, s) => t + b.share[s] * perQuarter(s) * horizon, 0);
      const change = (k: "mid" | "low" | "high") => SECTORS.reduce((t, s) => t + b.share[s] * sectorChange[s][k], 0);
      const changeUsd = { mid: Math.round(change("mid")), low: Math.round(change("low")), high: Math.round(change("high")) };
      const pct = (v: number) => (baselineUsd ? r1((v / baselineUsd) * 100) : 0);
      const contributions = SECTORS.map((s) => [s, b.share[s] * sectorChange[s].mid] as const).filter(([, v]) => v !== 0);
      const driver = contributions.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0]?.[0] ?? null;
      return { bank: b.bank, baselineUsd: Math.round(baselineUsd), changeUsd, changePct: { mid: pct(changeUsd.mid), low: pct(changeUsd.low), high: pct(changeUsd.high) }, driver };
    })
    .filter((o) => o.baselineUsd > 0)
    .sort((a, b) => b.changeUsd.mid - a.changeUsd.mid);
}
