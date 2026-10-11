/**
 * Final consistency pass over every stored deal, run at the end of each deal ingest. Pure (no EDGAR requests), so
 * it also repairs records stored before a rule existed. Each rule mirrors a check in `audit-rules.ts`.
 */
import { cleanPartyName, identicalNames, isMergerVehicle, isPlaceholderBuyer, isPlausibleName, normalizeName, sameCompany } from "./parse/names";
import { saneFee } from "./parse/terms";
import type { StoredDeal } from "./store";

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

/** Why a record isn't a deal Castle should show, or null when it is fine. */
export function junkReason(d: StoredDeal): string | null {
  for (const c of [d.acquirer, d.target]) if (!isPlausibleName(c.name) && !isPlaceholderBuyer(c.name)) return `implausible name "${c.name}"`;
  if (!d.target.cik && isMergerVehicle(d.target.name)) return `merger vehicle as target "${d.target.name}"`;
  if (d.acquirer.cik && d.acquirer.cik === d.target.cik) return "acquirer and target are the same registrant";
  // The same company on both sides once names are cleaned ("Nasdaq-listed Gryphon Digital Mining" buying
  // "Gryphon Digital Mining, Inc." was a reverse merger read as a self-deal).
  // The exact same name ignoring legal suffixes ("Viking Global Technologies" and "Viking Energy" are not).
  if (!(d.acquirer.cik && d.target.cik) && normalizeName(cleanPartyName(d.acquirer.name)) === normalizeName(cleanPartyName(d.target.name)))
    return "acquirer and target are the same company";
  // Business development companies are investment funds, out of scope: "BDC" in the name, or an "… Investment /
  // Capital / Finance / Credit Corp" with no industry code (operating companies have one; BDCs usually don't).
  if (!d.privateTarget && (/\bBDC\b/.test(d.target.name) || (!d.industry && /\b(?:Investment|Capital|Finance|Credit|Lending)\s+(?:Corp(?:oration)?|Inc\.?|Company)$/i.test(d.target.name.trim()))))
    return `investment fund as target "${d.target.name}"`;
  // A private company bought by a SPAC is a de-SPAC, out of scope ("Global Star Acquisition Inc." and K Enter: the
  // "Acquisition Corp" name check misses "Acquisition Inc."). Its industry comes from the buyer's SIC 6770, which a
  // de-SPACed operating company can keep for years (IEA in 2018), so the name must look like a SPAC too.
  if (d.privateTarget && /^blank checks?$/i.test(d.industry ?? "") && (SPAC_NAME.test(d.acquirer.name) || /\bAcquisition\b|\bCorp\.?\s+[IVX]+$/i.test(d.acquirer.name)))
    return `SPAC buyer "${d.acquirer.name}"`;
  // SPAC deals by name (the stored industry is today's SIC, which a de-SPACed company changes): a SPAC as the target
  // ("Hudson Executive Investment Corp.", "FS Development Corp. II"), or a SPAC, its sponsor or a fund as the buyer
  // ("Vine Hill Capital Investment Corp.", "HEC Sponsor LLC", "Tenor Opportunity Master Fund").
  // ("… Investment Corp." alone is no sign: Two Harbors, Chimera and Cherry Hill are mortgage REITs.)
  const spacLike = /\b(?:Executive|Strategic|Growth|Opportunit(?:y|ies)|Acquisition|Capital)\s+Investment\s+Corp(?:oration)?\b|\bCorp\.?\s+[IVX]+$/i;
  if (!d.privateTarget && (SPAC_NAME.test(d.target.name) || spacLike.test(d.target.name.trim()))) return `SPAC as target "${d.target.name}"`;
  if (spacLike.test(d.acquirer.name) || /\bSponsor\b|\bMaster Fund\b/i.test(d.acquirer.name)) return `SPAC or fund as buyer "${d.acquirer.name}"`;
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

  // Clean first, then judge: "Leading Loyalty Provider Punchh Inc." becomes "Punchh Inc." rather than being dropped.
  for (const d of [...deals]) {
    const changed = sanitizeDeal(d);
    const why = junkReason(d);
    if (why) drop(d, why);
    else if (changed) result.sanitized++;
  }

  // The same deal under two registrants of the same name (SailPoint, bought in 2022, relisted in 2025 under a new CIK,
  // was once filed under the new one): keep the older registrant, the one that existed when the deal was signed.
  const listed = deals.filter((d) => d.target.cik && !d.privateTarget).sort((a, b) => a.announcedDate.localeCompare(b.announcedDate));
  for (let i = 0; i < listed.length; i++) {
    for (let j = i + 1; j < listed.length && days(listed[i].announcedDate, listed[j].announcedDate) <= 14; j++) {
      const [a, b] = [listed[i], listed[j]];
      if (!deals.includes(a) || !deals.includes(b) || a.target.cik === b.target.cik) continue;
      if (!identicalNames(a.target.name, b.target.name) || !sameCompany(a.acquirer.name, b.acquirer.name)) continue;
      const [keep, extra] = Number(a.target.cik) < Number(b.target.cik) ? [a, b] : [b, a];
      merge(keep, extra);
      drop(extra, `same deal as ${keep.id} under a newer registrant of the same name`);
      result.merged++;
    }
  }

  // A shell "buying" a company that is itself buying another at the same time is that company's new holding company
  // (Marvell merging into "Maui HoldCo" to buy Inphi), not a takeover of it.
  for (const d of listed) {
    // Or a "New <target>" ("New R1" over R1 RCM, buying Cloudmed).
    const firstWord = d.target.name.split(/\s+/)[0]?.toLowerCase();
    const newSelf = /^New\s/i.test(d.acquirer.name) && d.acquirer.name.split(/\s+/)[1]?.toLowerCase() === firstWord;
    if (!deals.includes(d) || !(isPlaceholderBuyer(d.acquirer.name) || newSelf)) continue;
    const buying = deals.find((e) => e !== d && e.acquirer.cik === d.target.cik && Math.abs(days(e.announcedDate, d.announcedDate)) <= 30);
    if (buying) drop(d, `holding-company reorganization of ${d.target.name} for its deal ${buying.id}`);
  }

  // Two open records for the same listed target announced the same day are one deal named two ways (Heska: Mars, and
  // its subsidiary Antech from Heska's earnings release). Keep the better-documented one.
  for (const d of listed) {
    if (!deals.includes(d) || d.status === "Terminated") continue;
    const twin = listed.find(
      (e) => e !== d && deals.includes(e) && e.status !== "Terminated" && e.target.cik === d.target.cik && e.announcedDate === d.announcedDate,
    );
    if (!twin) continue;
    const score = (x: StoredDeal) => x.sources.length + (x.valueUsd != null ? 2 : 0) + (x.premiumPct != null ? 1 : 0) + (x.acquirer.cik ? 1 : 0);
    const [keep, extra] = score(d) >= score(twin) ? [d, twin] : [twin, d];
    // The kept record's buyer stands (merge would take the longer name: "Company entity" over TeraWulf for Ikonics).
    const buyer = { ...keep.acquirer };
    merge(keep, extra);
    keep.acquirer = buyer;
    drop(extra, `same deal as ${keep.id}, announced the same day with buyer "${extra.acquirer.name}"`);
    result.merged++;
  }

  // The same deal read both ways round (First Financial / Finward: the buyer's 8-K was read with the roles swapped).
  // The target is the side that files the merger proxy or tender response; keep that record.
  const proxyFirst = (d: StoredDeal) => /^(?:PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC14D9|SC TO-T)$/.test(d.milestones?.firstFiling?.form ?? "");
  for (const a of listed) {
    for (const b of listed) {
      if (a === b || !deals.includes(a) || !deals.includes(b) || !a.acquirer.cik || !b.acquirer.cik) continue;
      if (a.target.cik !== b.acquirer.cik || a.acquirer.cik !== b.target.cik || Math.abs(days(a.announcedDate, b.announcedDate)) > 60) continue;
      if (proxyFirst(a) && !proxyFirst(b)) {
        drop(b, `same deal as ${a.id} with buyer and target swapped`);
        result.merged++;
      }
    }
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
        // A later agreement with another buyer means the earlier one never closed, whatever the target's later
        // delisting says (Lockheed's 2020 deal for Aerojet ended in 2022; the Form 25 in 2023 was L3Harris's).
        // A company bought, relisted and bought again closed before the second deal was announced, and is kept.
        // The later deal must be a takeover of the whole company, with its own merger proxy or tender filing: a sale
        // of one business recorded under the parent (Constellation buying Black Knight's Empower unit) is not.
        const stillOpen = earlier.status === "Announced" || earlier.status === "Pending" || (earlier.status === "Closed" && !!earlier.statusDate && earlier.statusDate > later.announcedDate);
        const takeover = !!later.milestones?.firstFiling && later.milestones.firstFiling.date >= later.announcedDate;
        if (!sameBuyer && earlier.target.cik && gap > 120 && stillOpen && takeover && later.status !== "Terminated") {
          earlier.status = "Terminated";
          earlier.statusDate = null;
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
