/**
 * Company profiles, derived from the deal and IPO feeds: every company that appears as an
 * acquirer, target or IPO issuer gets a page. Pure, so it works on sample or real data.
 */
import type { Company, Deal, DealStatus, Filing, HubData, Ipo, Sector } from "./types";

/** Loose name key: case, punctuation and legal suffixes ignored ("Copart, Inc." = "COPART INC"). */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(the|inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|l|p|sa|nv|ag|se)$/.test(w))
    .join("-");
}

/** Generic buyer descriptions ("The Investor Group", "Parent") name different parties in different deals: no page. */
export const hasCompanyPage = (c: Company) =>
  !!c.cik || !/^(?:the\s+)?(?:investor group|buyer group|consortium|parent|buyer|purchaser|acquir[eo]r|company|undisclosed(?: \w+)*|private (?:buyer|investor)s?)$/i.test(c.name.trim());

/** URL id: the SEC CIK when known, else "n-" plus the name key. */
export const companyId = (c: Company) => (c.cik ? c.cik.replace(/^0+/, "") : `n-${nameKey(c.name)}`);
export const companyHref = (c: Company) => `/company/${encodeURIComponent(companyId(c))}`;

export type DealRole = "Acquirer" | "Target";

export interface CompanyDeal {
  deal: Deal;
  role: DealRole;
  counterparty: Company;
}

export interface CompanyBank {
  name: string;
  /** Mandates for this company: M&A buy side, sell side, IPO underwriting. */
  buySide: number;
  sellSide: number;
  ipo: number;
}

export interface CompanyProfile {
  id: string;
  company: Company;
  sector: Sector | null;
  industry: string | null;
  deals: CompanyDeal[];
  ipos: Ipo[];
  banks: CompanyBank[];
  filings: Filing[];
  /** Sum of disclosed values of deals where this company is the buyer. */
  acquiredValueUsd: number;
  latestActivity: { date: string; label: string } | null;
  /** Latest status of a deal in which the company is being acquired, if any. */
  saleStatus: DealStatus | null;
}

export function findCompany(data: Pick<HubData, "deals" | "ipos" | "activists">, id: string): CompanyProfile | null {
  if (!hasCompanyPage({ name: id.slice(2).replace(/-/g, " "), ticker: null, cik: id.startsWith("n-") ? null : id })) return null;
  const byCik = !id.startsWith("n-");
  const cik = byCik ? id.replace(/^0+/, "") : null;

  // The same company can appear with a CIK in one record and by name only in another.
  const names = new Set<string>();
  const matchesId = (c: Company) => (cik ? c.cik?.replace(/^0+/, "") === cik : !c.cik && `n-${nameKey(c.name)}` === id);
  for (const d of data.deals) for (const c of [d.acquirer, d.target]) if (matchesId(c)) names.add(nameKey(c.name));
  for (const i of data.ipos) if (matchesId(i.company)) names.add(nameKey(i.company.name));
  if (!names.size && !cik) names.add(id.slice(2));
  const matches = (c: Company) => matchesId(c) || (!c.cik && names.has(nameKey(c.name))) || (!cik && !!c.cik && names.has(nameKey(c.name)));

  const deals: CompanyDeal[] = [];
  for (const d of data.deals) {
    if (matches(d.target)) deals.push({ deal: d, role: "Target", counterparty: d.acquirer });
    else if (matches(d.acquirer)) deals.push({ deal: d, role: "Acquirer", counterparty: d.target });
  }
  deals.sort((a, b) => b.deal.announcedDate.localeCompare(a.deal.announcedDate));
  const ipos = data.ipos.filter((i) => matches(i.company)).sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  // Companies known only from an activist 13D still get a page.
  const stake = (data.activists ?? []).find((s) => matches(s.company));
  if (!deals.length && !ipos.length && !stake) return null;

  // Identity: SEC-registered records (targets, issuers) carry the official name and ticker.
  const asTarget = deals.find((d) => d.role === "Target")?.deal;
  const official = asTarget?.target ?? ipos[0]?.company ?? stake?.company ?? deals[0].deal.acquirer;
  const withTicker = [asTarget?.target, ipos[0]?.company, ...deals.filter((d) => d.role === "Acquirer").map((d) => d.deal.acquirer)].find((c) => c?.ticker);
  const company: Company = { name: official.name, ticker: official.ticker ?? withTicker?.ticker ?? null, cik: official.cik ?? cik };

  const banks = new Map<string, CompanyBank>();
  const credit = (name: string, key: "buySide" | "sellSide" | "ipo") => {
    const b = banks.get(name) ?? { name, buySide: 0, sellSide: 0, ipo: 0 };
    b[key]++;
    banks.set(name, b);
  };
  for (const { deal, role } of deals) for (const n of role === "Acquirer" ? deal.acquirerAdvisors : deal.targetAdvisors) credit(n, role === "Acquirer" ? "buySide" : "sellSide");
  for (const i of ipos) for (const n of i.underwriters) credit(n, "ipo");
  const total = (b: CompanyBank) => b.buySide + b.sellSide + b.ipo;

  const filings = new Map<string, Filing>();
  for (const { deal } of deals) for (const f of deal.filings) filings.set(f.url, f);
  for (const i of ipos) for (const f of i.filings) filings.set(f.url, f);

  const events = [
    ...deals.map((d) => ({
      date: d.deal.statusDate ?? d.deal.announcedDate,
      label: `${d.role === "Acquirer" ? "Buying" : "Sale to"} ${d.counterparty.name} · ${d.deal.status}`,
    })),
    ...ipos.map((i) => ({ date: i.pricedDate ?? i.filedDate, label: `IPO · ${i.stage}` })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return {
    id,
    company,
    sector: asTarget?.sector ?? ipos[0]?.sector ?? null,
    industry: asTarget?.industry ?? ipos[0]?.industry ?? null,
    deals,
    ipos,
    banks: [...banks.values()].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name)),
    filings: [...filings.values()].sort((a, b) => b.filedDate.localeCompare(a.filedDate)),
    acquiredValueUsd: deals.filter((d) => d.role === "Acquirer").reduce((s, d) => s + (d.deal.valueUsd ?? 0), 0),
    latestActivity: events[0] ?? null,
    saleStatus: asTarget?.status ?? null,
  };
}

/** Companies whose name or ticker matches `query` (lowercased), most active first. */
export function searchCompanies(data: Pick<HubData, "deals" | "ipos">, query: string, limit = 4): { company: Company; count: number }[] {
  if (!query) return [];
  const seen = new Map<string, { company: Company; count: number }>();
  const add = (c: Company) => {
    if (!hasCompanyPage(c)) return;
    if (!c.name.toLowerCase().includes(query) && !c.ticker?.toLowerCase().includes(query)) return;
    const id = companyId(c);
    const hit = seen.get(id);
    if (hit) hit.count++;
    else seen.set(id, { company: c, count: 1 });
  };
  for (const d of data.deals) {
    add(d.target);
    add(d.acquirer);
  }
  for (const i of data.ipos) add(i.company);
  return [...seen.values()].sort((a, b) => b.count - a.count || a.company.name.localeCompare(b.company.name)).slice(0, limit);
}

export const edgarCompanyUrl = (cik: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik.padStart(10, "0")}&owner=include&count=40`;
