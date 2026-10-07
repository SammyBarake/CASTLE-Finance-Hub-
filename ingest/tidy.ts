/**
 * Final consistency pass over every stored deal, run at the end of each deal ingest. Pure (no EDGAR requests), so
 * it also repairs records stored before a rule existed. Each rule mirrors a check in `audit-rules.ts`.
 */
import { cleanPartyName, isMergerVehicle, isPlaceholderBuyer, isPlausibleName, normalizeName, sameCompany } from "./parse/names";
import { saneFee } from "./parse/terms";
import type { StoredDeal } from "./store";

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

/** Why a record isn't a deal Castle should show, or null when it is fine. */
export function junkReason(d: StoredDeal): string | null {
  for (const c of [d.acquirer, d.target]) if (!isPlausibleName(c.name) && !isPlaceholderBuyer(c.name)) return `implausible name "${c.name}"`;
  if (!d.target.cik && isMergerVehicle(d.target.name)) return `merger vehicle as target "${d.target.name}"`;
  if (d.acquirer.cik && d.acquirer.cik === d.target.cik) return "acquirer and target are the same registrant";
  // Business development companies are investment funds, out of scope: "BDC" in the name, or an "… Investment /
  // Capital / Finance / Credit Corp" with no industry code (operating companies have one; BDCs usually don't).
  if (!d.privateTarget && (/\bBDC\b/.test(d.target.name) || (!d.industry && /\b(?:Investment|Capital|Finance|Credit|Lending)\s+(?:Corp(?:oration)?|Inc\.?|Company)$/i.test(d.target.name.trim()))))
    return `investment fund as target "${d.target.name}"`;
  // A private company bought by a SPAC is a de-SPAC, out of scope ("Global Star Acquisition Inc." and K Enter: the
  // "Acquisition Corp" name check misses "Acquisition Inc."). Its industry comes from the buyer's SIC 6770, which a
  // de-SPACed operating company can keep for years (IEA in 2018), so the name must look like a SPAC too.
  if (d.privateTarget && /^blank checks?$/i.test(d.industry ?? "") && (SPAC_NAME.test(d.acquirer.name) || /\bAcquisition\b|\bCorp\.?\s+[IVX]+$/i.test(d.acquirer.name)))
    return `SPAC buyer "${d.acquirer.name}"`;
  // (A private target with a share price or premium is resolved against EDGAR during enrichment, not dropped here:
  // private banks quote per-share prices too.)
  return null;
}

/** Fix values no real deal can have. Returns true when anything changed. */
export function sanitizeDeal(d: StoredDeal): boolean {
  const before = JSON.stringify([d.premiumPct, d.valueUsd, d.terms, d.acquirerAdvisors, d.acquirer.name, d.target.name]);
  // Names without a CIK are never replaced by an SEC name: give them today's clean-up rules
  // ("Sculptor Capital Management Together" -> "Sculptor Capital Management").
  for (const c of [d.acquirer, d.target]) {
    if (c.cik) continue;
    const clean = cleanPartyName(c.name);
    if (clean !== c.name && isPlausibleName(clean)) c.name = clean;
  }
  // Premium over the unaffected price: take-unders exist, but beyond these bands it was read off another figure.
  if (d.premiumPct != null && (d.premiumPct < -50 || d.premiumPct > 300)) d.premiumPct = null;
  if (d.valueUsd != null && d.valueUsd < 1e6) {
    d.valueUsd = null;
    d.valueKind = null;
  }
  if (d.terms) {
    d.terms.targetFeeUsd = saneFee(d.terms.targetFeeUsd, d.valueUsd, "target");
    d.terms.reverseFeeUsd = saneFee(d.terms.reverseFeeUsd, d.valueUsd, "reverse");
  }
  // A bank advises one side. The target's list comes from its own proxy when there is one, so it wins.
  if (d.acquirerAdvisors.some((a) => d.targetAdvisors.includes(a))) d.acquirerAdvisors = d.acquirerAdvisors.filter((a) => !d.targetAdvisors.includes(a));
  return JSON.stringify([d.premiumPct, d.valueUsd, d.terms, d.acquirerAdvisors, d.acquirer.name, d.target.name]) !== before;
}

/** Fold `later` into `keep`: the same deal recorded twice (a buyer's short form, "H&F" vs "Hellman & Friedman"). */
function merge(keep: StoredDeal, later: StoredDeal) {
  if (later.acquirer.name.length > keep.acquirer.name.length && !isPlaceholderBuyer(later.acquirer.name)) keep.acquirer.name = later.acquirer.name;
  keep.acquirer.cik ??= later.acquirer.cik;
  keep.acquirer.ticker ??= later.acquirer.ticker;
  for (const k of ["valueUsd", "pricePerShare", "premiumPct", "consideration", "enterpriseValueUsd", "evEbitda", "evRevenue"] as const) {
    if (keep[k] == null && later[k] != null) (keep as unknown as Record<string, unknown>)[k] = later[k];
  }
  if (keep.valueKind == null) keep.valueKind = later.valueKind;
  keep.acquirerAdvisors = [...new Set([...keep.acquirerAdvisors, ...later.acquirerAdvisors])];
  keep.targetAdvisors = [...new Set([...keep.targetAdvisors, ...later.targetAdvisors])];
  for (const f of later.filings) if (!keep.filings.some((x) => x.url === f.url)) keep.filings.push(f);
  keep.filings.sort((a, b) => a.filedDate.localeCompare(b.filedDate));
  keep.sources = [...new Set([...keep.sources, ...later.sources])];
  // The later record may have seen the outcome (a completion, a termination).
  if (later.status === "Closed" || later.status === "Terminated") {
    keep.status = later.status;
    keep.statusDate = later.statusDate;
  }
}

export interface TidyResult {
  dropped: { id: string; reason: string }[];
  merged: number;
  /** Earlier agreements marked Terminated because another buyer signed with the same target. */
  topped: number;
  sanitized: number;
}

export function tidyDeals(deals: StoredDeal[]): TidyResult {
  const result: TidyResult = { dropped: [], merged: 0, topped: 0, sanitized: 0 };
  const drop = (d: StoredDeal, reason: string) => {
    deals.splice(deals.indexOf(d), 1);
    result.dropped.push({ id: d.id, reason });
  };

  for (const d of [...deals]) {
    const why = junkReason(d);
    if (why) drop(d, why);
    else if (sanitizeDeal(d)) result.sanitized++;
  }

  // Group by target: the CIK for listed targets, the name for private ones.
  const byTarget = new Map<string, StoredDeal[]>();
  for (const d of deals) {
    const key = d.target.cik ? `c:${d.target.cik}` : `n:${normalizeName(d.target.name)}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), d]);
  }
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.announcedDate.localeCompare(b.announcedDate));
    for (let i = 1; i < group.length; i++) {
      const later = group[i];
      for (let j = i - 1; j >= 0; j--) {
        const earlier = group[j];
        if (!deals.includes(earlier)) continue;
        const gap = days(earlier.announcedDate, later.announcedDate);
        const sameBuyer = sameCompany(earlier.acquirer.name, later.acquirer.name) || (!!earlier.acquirer.cik && earlier.acquirer.cik === later.acquirer.cik);
        if (sameBuyer && gap <= 60) {
          merge(earlier, later);
          drop(later, `duplicate of ${earlier.id}`);
          result.merged++;
          break;
        }
        // A rival buyer signing with the same listed target within four months topped the earlier agreement
        // (Optum over Option Care for Amedisys, MITER over Masonite for PGT): that agreement was terminated.
        if (!sameBuyer && earlier.target.cik && gap > 0 && gap <= 120 && earlier.status !== "Terminated" && later.status !== "Terminated") {
          earlier.status = "Terminated";
          earlier.statusDate = later.announcedDate;
          // Re-derived on the next run with the termination date (the target's closing filings belong to the winner).
          earlier.milestones = undefined;
          result.topped++;
          break;
        }
      }
    }
  }
  return result;
}

/** Acquirer name of a SPAC (blank-check company), out of scope as a buyer. */
export const SPAC_NAME =
  /\b(?:Acquisition|Merger|Growth Opportunit(?:y|ies))\s+(?:Corp(?:oration)?|Co|Company|Ltd|Limited|Inc)\b|\bCapital Corp\.?\s+[IVX]+\b|\bBlank Check\b/i;
