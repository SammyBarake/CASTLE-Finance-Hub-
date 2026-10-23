/**
 * How the dataset travels to the browser: two downloads instead of one, the first packed by column.
 *
 * - `/api/hub` (the core): everything the list pages need (Deal Flow, the Hub, Precedents' table, IPOs, the league
 *   table …). Deals travel as columns (`packRows`: one array per field instead of 2,600 objects repeating every
 *   field name) with each source-filing link shortened to its EDGAR path. October 2026: 383 KB as the CDN served
 *   the old feed → ~205 KB, and the JSON a phone parses from 2.4 MB to under 1 MB.
 * - `/api/hub/details` (~80 KB), fetched right after it: the per-deal detail only a few pages read (deal
 *   protections, the buyer's share reaction, the banks' DCF, filing milestones), activist stakes and advisory fees.
 *
 * HubDataProvider rebuilds the deals and merges the two (`expandCore`, `withDetails`); pages that are mostly details
 * wait for both (`NEEDS_DETAILS` in components/shell/routes.ts). Server-side readers (tear sheets, live CSV links,
 * previews) use getHubData() and never see this format. Pure and tested: the round trip gives back exactly the deals
 * the server had.
 */
import type { ActivistStake, Deal, FeeRow, HubData } from "./types";

export const DETAIL_FIELDS = ["terms", "reaction", "dcf", "milestones"] as const;
export type DealDetails = Partial<Pick<Deal, (typeof DETAIL_FIELDS)[number]>>;

export interface HubDetails {
  /** The dataset these details belong to (the core's `asOf`). */
  asOf: string;
  /** Detail fields by deal id, for the deals that have any. */
  deals: Record<string, DealDetails>;
  activists: ActivistStake[];
  fees: FeeRow[];
}

/**
 * Rows stored by column. A field every row has is one array (a field whose values are all objects, such as a deal's
 * acquirer, is packed the same way, one level down); a field only some rows have is an index → value map, so an
 * absent field stays absent and a null stays null.
 */
export interface Packed {
  n: number;
  cols: Record<string, unknown[] | { packed: Packed }>;
  sparse: Record<string, Record<string, unknown>>;
}

/** The core as /api/hub sends it: HubData with the deals packed (`dealColumns`) instead of listed. */
export type WireCore = Omit<HubData, "deals"> & { dealColumns: Packed };

type Row = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);

export function packRows(rows: Row[]): Packed {
  const n = rows.length;
  const counts = new Map<string, number>();
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (v !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1);
  const cols: Packed["cols"] = {};
  const sparse: Packed["sparse"] = {};
  for (const [k, count] of counts) {
    if (count === n) {
      const values = rows.map((r) => r[k]);
      cols[k] = values.every(isPlainObject) ? { packed: packRows(values as Row[]) } : values;
    } else {
      const map: Record<string, unknown> = {};
      rows.forEach((r, i) => {
        if (r[k] !== undefined) map[i] = r[k];
      });
      sparse[k] = map;
    }
  }
  return { n, cols, sparse };
}

export function unpackRows(p: Packed): Row[] {
  const rows: Row[] = Array.from({ length: p.n }, () => ({}));
  for (const [k, col] of Object.entries(p.cols)) {
    const values = Array.isArray(col) ? col : unpackRows(col.packed);
    for (let i = 0; i < p.n; i++) rows[i][k] = values[i];
  }
  for (const [k, map] of Object.entries(p.sparse)) for (const [i, v] of Object.entries(map)) rows[Number(i)][k] = v;
  return rows;
}

const EDGAR = "https://www.sec.gov/Archives/edgar/data/";
const absolute = (url: string) => /^https?:\/\//.test(url);

/** The core download: no detail fields, activists or fees; EDGAR links as paths; deals packed by column. */
export function hubCore(full: HubData): WireCore {
  const rest: Partial<HubData> = { ...full };
  delete rest.activists;
  delete rest.fees;
  delete rest.deals;
  const deals = full.deals.map((d) => {
    const core: Deal = { ...d };
    for (const f of DETAIL_FIELDS) delete core[f];
    core.filings = d.filings.map((f) => (f.url.startsWith(EDGAR) ? { ...f, url: f.url.slice(EDGAR.length) } : f));
    return core;
  });
  return { ...(rest as Omit<HubData, "deals">), dealColumns: packRows(deals as unknown as Row[]) };
}

export function hubDetails(full: HubData): HubDetails {
  const deals: Record<string, DealDetails> = {};
  for (const d of full.deals) {
    const detail: DealDetails = {};
    for (const f of DETAIL_FIELDS) if (d[f] != null) Object.assign(detail, { [f]: d[f] });
    if (Object.keys(detail).length) deals[d.id] = detail;
  }
  return { asOf: full.asOf, deals, activists: full.activists ?? [], fees: full.fees ?? [] };
}

/** The core as the browser uses it: deals rebuilt, with full EDGAR links again. */
export function expandCore(wire: WireCore): HubData {
  const { dealColumns, ...rest } = wire;
  const deals = (unpackRows(dealColumns) as unknown as Deal[]).map((d) =>
    d.filings.some((f) => !absolute(f.url)) ? { ...d, filings: d.filings.map((f) => (absolute(f.url) ? f : { ...f, url: EDGAR + f.url })) } : d,
  );
  return { ...rest, deals };
}

/** The core with its details folded back in (deals unchanged where there's nothing to add). */
export function withDetails(core: HubData, details: HubDetails | null): HubData {
  if (!details) return core;
  return {
    ...core,
    deals: core.deals.map((d) => (details.deals[d.id] ? { ...d, ...details.deals[d.id] } : d)),
    activists: details.activists,
    fees: details.fees,
  };
}
