/**
 * Data-quality rules: every check a record should pass before anyone relies on it. Pure functions so they can be
 * tested; `ingest/audit.ts` runs them over the whole dataset and prints what fails.
 */
import { identicalNames, isPlaceholderBuyer, isPlausibleName, normalizeName } from "./parse/names";
import type { Deal, Ipo } from "../lib/types";

export interface Finding {
  rule: string;
  id: string;
  detail: string;
}

const HEADLINE_WORDS = /\b(?:announces?|acquires?|completes?|agrees?|signs?|enters?|to acquire|to be acquired|merger agreement|definitive agreement|press release|today)\b/i;
/** Two to five names joined by commas and "and", each under 60 characters and starting with a capital, not a description ("Joint Venture Backed by …"). */
export function jointList(name: string): boolean {
  const parts = name.split(/,\s*(?:and\s+)?|\s+and\s+/);
  return name.length <= 130 && parts.length >= 2 && parts.length <= 5 && parts.every((p) => p.length >= 2 && p.length < 60 && /^[A-Z]/.test(p) && !/\b(?:Backed|Led|Formed|Controlled|Owned)\s+by\b/i.test(p));
}
const pct = (fee: number | null | undefined, value: number | null) => (fee != null && value ? (fee / value) * 100 : null);

export function auditDeal(d: Deal, asOf: string): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, detail: string) => out.push({ rule, id: d.id, detail: `${d.acquirer.name} -> ${d.target.name} (${d.announcedDate}): ${detail}` });

  // Names (a lowercase start is fine: scPharmaceuticals, iTeos, indie, e.l.f.)
  for (const [role, c] of [["acquirer", d.acquirer], ["target", d.target]] as const) {
    // (A registrant's SEC name is never a placeholder: "E2open Parent Holdings, Inc.", "Concentra Group Holdings Parent, Inc.".)
    if (role === "acquirer" && isPlaceholderBuyer(c.name) && !c.cik) add("placeholder-buyer", `no filing names the buyer behind "${c.name}"`);
    else if (!isPlausibleName(c.name)) add("name-implausible", `${role} "${c.name}"`);
    else if (HEADLINE_WORDS.test(c.name)) add("name-headline-words", `${role} "${c.name}"`);
    // (Joint buyers named in full are long and right: "Elliott Investment Management, Patient Square Capital and Veritas Capital". Each part must be a name of its own.)
    else if (c.name.length > 70 && !jointList(c.name)) add("name-too-long", `${role} "${c.name}"`);
  }
  if (identicalNames(d.acquirer.name, d.target.name) || (d.acquirer.cik && d.acquirer.cik === d.target.cik)) add("same-company", "acquirer and target look identical");

  // Money
  if (d.valueUsd != null && (d.valueUsd < 1e6 || d.valueUsd > 3e11)) add("value-out-of-range", `$${(d.valueUsd / 1e9).toFixed(3)}B`);
  if (d.privateTarget && d.valueUsd != null && d.valueUsd > 4e10) add("private-value-too-large", `$${(d.valueUsd / 1e9).toFixed(1)}B`);
  // A buy-in's value is the stake bought (Hamm's 17% of Continental), so it compares with that share of the EV. Two shapes are
  // real and common, not misreads: a small cash shell worth little more than its cash (EV near zero: Cepton, Repare, Rain), and a
  // small, heavily indebted company bought at a stated price (Sotherly, Urgent.ly). A misread value is large or stated as one.
  // (Stored as a percentage, or `true` when the stake isn't stated: then the value is blank unless one is stated, and compares whole.)
  const stake = (d as { buyIn?: number | true }).buyIn;
  const evShare = d.enterpriseValueUsd && typeof stake === "number" ? d.enterpriseValueUsd * (stake / 100) : d.enterpriseValueUsd;
  const evRatio = d.valueUsd && evShare ? evShare / d.valueUsd : null;
  const cashShell = evRatio != null && evRatio < 0.15 && d.valueUsd! < 250e6;
  const smallAndIndebted = evRatio != null && evRatio > 6 && d.valueUsd! < 100e6 && d.pricePerShare != null;
  if (evRatio != null && (evRatio > 6 || evRatio < 0.15) && !cashShell && !smallAndIndebted)
    add("value-vs-ev-mismatch", `value $${(d.valueUsd! / 1e9).toFixed(2)}B vs EV $${(d.enterpriseValueUsd! / 1e9).toFixed(2)}B`);
  if (d.pricePerShare != null && (d.pricePerShare < 0.05 || d.pricePerShare > 5000)) add("price-out-of-range", `$${d.pricePerShare}`);

  // Premium and multiples
  if (d.premiumPct != null && (d.premiumPct < -50 || d.premiumPct > 300)) add("premium-out-of-range", `${d.premiumPct}%`);
  if (d.privateTarget && d.premiumPct != null) add("private-with-premium", `${d.premiumPct}%`);
  if (d.evEbitda != null && (d.evEbitda <= 0 || d.evEbitda > 50)) add("ev-ebitda-out-of-range", `${d.evEbitda}x`);
  if (d.evRevenue != null && (d.evRevenue <= 0 || d.evRevenue > 60)) add("ev-revenue-out-of-range", `${d.evRevenue}x`);

  // Dates and status
  if (d.announcedDate > asOf.slice(0, 10)) add("announced-in-future", d.announcedDate);
  if (d.announcedDate < "2020-01-01") add("announced-too-old", d.announcedDate);
  if (d.statusDate && d.statusDate < d.announcedDate) add("status-before-announcement", `${d.status} ${d.statusDate}`);
  // A private purchase confirmed only by the buyer's later 10-Q ("we acquired …") often has no stated closing date.
  if (d.status === "Closed" && !d.statusDate && !d.privateTarget) add("closed-without-date", "");
  const m = d.milestones;
  if (m?.closed && m.closed < d.announcedDate) add("milestone-before-announcement", `closed ${m.closed}`);
  const age = (Date.parse(asOf) - Date.parse(d.announcedDate)) / 86_400_000;
  // A listed target that filed no merger proxy or tender response and no closing, four months on: usually a deal read backwards or the wrong company.
  if (!d.privateTarget && d.status !== "Terminated" && age > 120 && !m?.firstFiling && !m?.closed) add("public-target-filed-nothing", `${d.status}, ${Math.round(age)} days on`);
  // A private purchase still open two years on: nothing the buyer filed says it closed or ended.
  if (d.privateTarget && (d.status === "Announced" || d.status === "Pending") && age > 730) add("private-open-two-years", `${d.status}, ${Math.round(age)} days on`);

  // Deal protections
  const t = d.terms;
  if (t) {
    const tf = pct(t.targetFeeUsd, d.valueUsd);
    const rf = pct(t.reverseFeeUsd, d.valueUsd);
    if (tf != null && (tf < 0.3 || tf > 10)) add("break-fee-unusual", `${tf.toFixed(1)}% of value`);
    if (rf != null && (rf < 0.3 || rf > 12)) add("reverse-fee-unusual", `${rf.toFixed(1)}% of value`);
    if (t.goShopDays != null && (t.goShopDays < 10 || t.goShopDays > 90)) add("go-shop-days-unusual", `${t.goShopDays} days`);
  }

  // Advisors
  const both = d.acquirerAdvisors.filter((a) => d.targetAdvisors.includes(a));
  if (both.length) add("advisor-both-sides", both.join(", "));
  return out;
}

/** The same target announced twice within 60 days under different records. */
export function duplicateDeals(deals: Deal[]): Finding[] {
  const out: Finding[] = [];
  const byTarget = new Map<string, Deal[]>();
  for (const d of deals) {
    const key = d.target.cik ?? `n:${normalizeName(d.target.name)}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), d]);
  }
  for (const group of byTarget.values()) {
    const sorted = [...group].sort((a, b) => a.announcedDate.localeCompare(b.announcedDate));
    for (let i = 1; i < sorted.length; i++) {
      const gap = (Date.parse(sorted[i].announcedDate) - Date.parse(sorted[i - 1].announcedDate)) / 86_400_000;
      if (gap <= 60 && sorted[i].status !== "Terminated" && sorted[i - 1].status !== "Terminated")
        out.push({ rule: "duplicate-deal", id: sorted[i].id, detail: `${sorted[i - 1].acquirer.name} (${sorted[i - 1].announcedDate}) and ${sorted[i].acquirer.name} (${sorted[i].announcedDate}) -> ${sorted[i].target.name}` });
    }
  }
  return out;
}

export function auditIpo(i: Ipo, asOf: string): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, detail: string) => out.push({ rule, id: i.id, detail: `${i.company.name}: ${detail}` });
  if (!isPlausibleName(i.company.name)) add("ipo-name-implausible", i.company.name);
  // The largest IPOs ever raised ~$30B; a mega-IPO could plausibly raise a few times that.
  if (i.expectedRaiseUsd != null && (i.expectedRaiseUsd < 5e6 || i.expectedRaiseUsd > 1e11)) add("ipo-raise-out-of-range", `$${(i.expectedRaiseUsd / 1e6).toFixed(0)}M`);
  if (i.filedDate > asOf.slice(0, 10)) add("ipo-filed-in-future", i.filedDate);
  if (i.stage !== "Filed" && !i.pricedDate) add("ipo-priced-without-date", i.stage);
  if (i.offerPrice != null && (i.offerPrice < 1 || i.offerPrice > 500)) add("ipo-price-out-of-range", `$${i.offerPrice}`);
  return out;
}
