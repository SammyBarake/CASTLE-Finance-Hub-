/**
 * Final consistency pass over every stored deal, run at the end of each deal ingest. Pure (no EDGAR requests), so
 * it also repairs records stored before a rule existed. Each rule mirrors a check in `audit-rules.ts`.
 */
import { cleanPartyName, identicalNames, isDescriptionOnly, isMergerVehicle, isPlaceholderBuyer, isPlausibleName, isTickerOf, namesExtend, normalizeName, privateNameMatch, sameCompany } from "./parse/names";
import { near, sameBuyer } from "./reactions";
import { saneFee } from "./parse/terms";
import { findBanks } from "../lib/banks";
import type { StoredDeal } from "./store";

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

const RELEASE_FORM = /EX-99/i;
const RELEASE_FILE = /ex[-_ ]?99|exhibit[-_ ]?99|press[-_ ]?release/i;

/**
 * The site links a deal to its first filing, and a bare 8-K or 425 often states the price and little else, while the press
 * release in the same filing states the value, the premium and the banks. A deal keeps one link per filing, so whichever
 * document was read first won. So: a release the deal was read from gets a link of its own, and on the same day a release
 * comes first. (Varonis's first link was the 8-K cover, with the $6.3 billion release beside it in the same accession.)
 */
export function putReleaseFirst(d: Pick<StoredDeal, "filings" | "sources">): void {
  const first = d.filings[0];
  if (first && !RELEASE_FORM.test(first.form)) {
    const path = /^(.*\/(\d{18})\/)[^/]*$/.exec(first.url);
    // By name, so an exhibit 99.1 comes before its 99.2, usually the deck.
    const file = path && d.sources.map((s) => s.split(":")).filter(([adsh, name]) => adsh?.replace(/-/g, "") === path[2] && name && RELEASE_FILE.test(name)).map(([, name]) => name).sort()[0];
    if (path && file && !d.filings.some((f) => f.url.endsWith(`/${file}`))) d.filings.push({ form: `${first.form} (EX-99)`, filedDate: first.filedDate, url: path[1] + file });
  }
  d.filings.sort((a, b) => a.filedDate.localeCompare(b.filedDate) || releaseRank(a.form) - releaseRank(b.form));
}

/**
 * Same day: an 8-K's exhibit is the release; a 425 or a tender communication's is as often an employee memo or a deck (J&J /
 * Abiomed's "Investor Presentation", Novartis / Avidity's "All Employee Q&A"), and a 99.2 more often than a 99.1.
 */
const releaseRank = (form: string) => (!RELEASE_FORM.test(form) ? 4 : (/^8-K/i.test(form) ? 0 : 2) + (/EX-99\.[2-9]/i.test(form) ? 1 : 0));

/** Why a record isn't a deal Castle should show, or null when it is fine. */
export function junkReason(d: StoredDeal): string | null {
  for (const c of [d.acquirer, d.target]) if (!isPlausibleName(c.name) && !isPlaceholderBuyer(c.name)) return `implausible name "${c.name}"`;
  if (!d.target.cik && isMergerVehicle(d.target.name)) return `merger vehicle as target "${d.target.name}"`;
  if (d.privateTarget && BASIN_NAME.test(d.target.name.trim())) return `asset purchase in a basin "${d.target.name}"`;
  if (d.privateTarget && HOTEL_PROPERTY.test(d.target.name)) return `a hotel property "${d.target.name}"`;
  if (d.privateTarget && /^[A-Za-z]+(?:-[A-Za-z]+){2,}$/.test(d.target.name.trim())) return `description as target "${d.target.name}"`;
  // No name at all: "Edge AI Pioneer", "Water Treatment Company", "Privately Held" (the release never named it).
  if (d.privateTarget && isDescriptionOnly(d.target.name)) return `description as target "${d.target.name}"`;
  if (d.acquirer.cik && d.acquirer.cik === d.target.cik) return "acquirer and target are the same registrant";
  // The same company on both sides once names are cleaned ("Nasdaq-listed Gryphon Digital Mining" buying
  // "Gryphon Digital Mining, Inc." was a reverse merger read as a self-deal).
  // The exact same name ignoring legal suffixes ("Viking Global Technologies" and "Viking Energy" are not).
  // (Not a private target bought by a registrant: in a reverse merger the buyer takes the target's name, and enrichment
  // gives it the name it had then: Blackboxstocks for REalloys, Sigma Additive for NextTrip.)
  if (!(d.acquirer.cik && d.target.cik) && !(d.privateTarget && d.acquirer.cik) && normalizeName(cleanPartyName(d.acquirer.name)) === normalizeName(cleanPartyName(d.target.name)))
    return "acquirer and target are the same company";
  // Business development companies are investment funds, out of scope: "BDC" in the name, or an "… Investment /
  // Capital / Finance / Credit Corp" with no industry code (operating companies have one; BDCs usually don't).
  if (!d.privateTarget && (/\bBDC\b/.test(d.target.name) || (!d.industry && /\b(?:Investment|Capital|Finance|Credit|Lending)\s+(?:Corp(?:oration|\.)?|Inc\.?|Company)$/i.test(d.target.name.trim()))))
    return `investment fund as target "${d.target.name}"`;
  // A private company bought by a SPAC is a de-SPAC, out of scope ("Global Star Acquisition Inc." and K Enter: the
  // "Acquisition Corp" name check misses "Acquisition Inc."). Its industry comes from the buyer's SIC 6770, which a
  // de-SPACed operating company can keep for years (IEA in 2018), so the name must look like a SPAC too.
  if (d.privateTarget && /^blank checks?$/i.test(d.industry ?? "") && (SPAC_NAME.test(d.acquirer.name) || /\bAcquisition\b|\bCorp\.?\s+[IVX]+$/i.test(d.acquirer.name)))
    return `SPAC buyer "${d.acquirer.name}"`;
  // A SPAC's name alone, once its industry code has changed with the business it bought ("Rice Acquisition Corp."
  // became Archaea Energy): no operating company buys a private business under an "… Acquisition Corp." name.
  if (d.privateTarget && SPAC_NAME.test(d.acquirer.name)) return `SPAC buyer "${d.acquirer.name}"`;
  // SPAC deals by name (the stored industry is today's SIC, which a de-SPACed company changes): a SPAC as the target
  // ("Hudson Executive Investment Corp.", "FS Development Corp. II"), or a SPAC, its sponsor or a fund as the buyer
  // ("Vine Hill Capital Investment Corp.", "HEC Sponsor LLC", "Tenor Opportunity Master Fund").
  // ("… Investment Corp." alone is no sign: Two Harbors, Chimera and Cherry Hill are mortgage REITs.)
  const spacLike = /\b(?:Executive|Strategic|Growth|Opportunit(?:y|ies)|Acquisition|Capital)\s+Investment\s+Corp(?:oration)?\b|\bCorp\.?\s+[IVX]+$/i;
  if (!d.privateTarget && (SPAC_NAME.test(d.target.name) || spacLike.test(d.target.name.trim()))) return `SPAC as target "${d.target.name}"`;
  if (spacLike.test(d.acquirer.name) || /\bSponsor\b|\bMaster Fund\b/i.test(d.acquirer.name)) return `SPAC or fund as buyer "${d.acquirer.name}"`;
  // A national bank subsidiary is a lender, not a buyer ("Citibank, N.A." in Synnex's financing for Tech Data).
  if (/,?\s+N\.\s?A\.?$/.test(d.acquirer.name.trim())) return `a bank (lender) as buyer "${d.acquirer.name}"`;
  // (A private target with a share price or premium is resolved against EDGAR during enrichment, not dropped here:
  // private banks quote per-share prices too.)
  return null;
}

/**
 * Filings can't date this one. Frank's International merged with Expro on October 1 2021 and kept reporting as Expro Group
 * ("became effective on October 1, 2021 (the "Closing Date")"), so no closing filing exists, and its 2026 sale's proxy and
 * Form 25 read as this deal's. Runs before enrichment too, so the date bounds what it reads (`ownFilings`).
 */
export function correctKnownClosing(d: StoredDeal): void {
  if (d.target.cik !== "1575828" || !d.announcedDate.startsWith("2021-")) return;
  d.status = "Closed";
  d.statusDate = "2021-10-01";
  // What came from the 2026 proxy goes, once.
  if (d.fairnessAdsh) {
    d.fairness = d.proxySections = undefined;
    d.fairnessAdsh = d.meetingDate = null;
    d.terms = undefined;
    d.termsCheckedAt = null;
  }
  if (d.milestones) d.milestones = { ...d.milestones, definitiveProxy: null, voteHeld: null, closed: "2021-10-01" };
}

/**
 * A bank that is the buyer itself never advises the target: it moves to the buyer's list, where a bank advising itself stays credited
 * (Goldman Sachs / GreenSky, RBC / City National). Raymond James read as TriState Capital's adviser, whose bank was Stephens.
 */
export function moveBuyerOffTarget(d: Pick<StoredDeal, "acquirer" | "acquirerAdvisors" | "targetAdvisors">): void {
  const itself = findBanks(d.acquirer.name).filter((b) => d.targetAdvisors.includes(b));
  if (!itself.length) return;
  d.targetAdvisors = d.targetAdvisors.filter((b) => !itself.includes(b));
  d.acquirerAdvisors = [...new Set([...d.acquirerAdvisors, ...itself])];
}

/** Fix values no real deal can have. Returns true when anything changed. */
export function sanitizeDeal(d: StoredDeal): boolean {
  const before = JSON.stringify([d.premiumPct, d.valueUsd, d.terms, d.acquirerAdvisors, d.acquirer.name, d.target.name, d.statusDate]);
  correctKnownClosing(d);
  moveBuyerOffTarget(d);
  // Names without a CIK are never replaced by an SEC name: give them today's clean-up rules
  // ("Sculptor Capital Management Together" -> "Sculptor Capital Management").
  for (const c of [d.acquirer, d.target]) {
    if (c.cik) continue;
    const clean = cleanPartyName(c.name);
    if (clean !== c.name && isPlausibleName(clean)) c.name = clean;
  }
  // A listed target closed without a date: its own filings' closing date (the buyer-filings check once closed six
  // foreign targets, Merck / Verona among them, before their Form 25 was read).
  if (!d.privateTarget && d.status === "Closed" && !d.statusDate && d.milestones?.closed) d.statusDate = d.milestones.closed;
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
  return JSON.stringify([d.premiumPct, d.valueUsd, d.terms, d.acquirerAdvisors, d.acquirer.name, d.target.name, d.statusDate]) !== before;
}

/** Fold `later` into `keep`: the same deal recorded twice (a buyer's short form, "H&F" vs "Hellman & Friedman"). */
function merge(keep: StoredDeal, later: StoredDeal) {
  // A reaction can't be fetched again (ingest/reactions.ts), and it's about its own buyer's shares: a record merged from a
  // rival's or a loosely matched name doesn't pass one across. Asked before the names below change.
  if (sameBuyer(keep.acquirer, later.acquirer)) {
    keep.reaction ??= later.reaction;
    keep.reactionCheckedAt ??= later.reactionCheckedAt;
  }
  if (later.acquirer.name.length > keep.acquirer.name.length && !isPlaceholderBuyer(later.acquirer.name)) keep.acquirer.name = later.acquirer.name;
  keep.acquirer.cik ??= later.acquirer.cik;
  keep.acquirer.ticker ??= later.acquirer.ticker;
  // A stated value replaces price × shares, and the enterprise value follows it (U.S. Silica's $1.85B).
  if (keep.valueImplied && later.valueUsd != null && !later.valueImplied) {
    keep.valueUsd = later.valueUsd;
    keep.valueKind = later.valueKind;
    delete keep.valueImplied;
    keep.financialsCheckedAt = null;
  }
  for (const k of ["valueUsd", "pricePerShare", "premiumPct", "consideration", "enterpriseValueUsd", "evEbitda", "evEbitdaReported", "evRevenue"] as const) {
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
    // A changed outcome needs its timeline re-derived (the next run does it from the filing index).
    if (keep.status !== later.status) keep.milestones = undefined;
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

const daysApart = (a: StoredDeal, b: StoredDeal) => Math.abs(days(a.announcedDate, b.announcedDate));
const listedBuyer = (a: StoredDeal, b: StoredDeal) => (!!a.acquirer.cik && a.acquirer.cik === b.acquirer.cik) || (!!a.acquirer.ticker && !!b.acquirer.ticker && a.acquirer.ticker.toUpperCase() === b.acquirer.ticker.toUpperCase());
const namedBuyer = (a: StoredDeal, b: StoredDeal) => listedBuyer(a, b) || ((!a.acquirer.cik || !b.acquirer.cik) && sameCompany(a.acquirer.name, b.acquirer.name));
const within = (x: number | null, y: number | null, tolerance: number) => x == null || y == null || Math.abs(x - y) <= tolerance * Math.max(x, y);
const paidAlike = (a: StoredDeal, b: StoredDeal) => !a.consideration || !b.consideration || a.consideration === b.consideration || a.consideration === "Mixed" || b.consideration === "Mixed";
const nothingDiffers = (a: StoredDeal, b: StoredDeal) => within(a.valueUsd, b.valueUsd, 0.02) && within(a.pricePerShare, b.pricePerShare, 0.001) && paidAlike(a, b);
const filerCiks = (d: StoredDeal) => new Set(d.filings.map((f) => Number(/edgar\/data\/(\d+)\//.exec(f.url)?.[1])));
const accessions = (d: StoredDeal) => new Set(d.sources.map((s) => s.split(":")[0]));
const shareFiling = (a: StoredDeal, b: StoredDeal) => {
  const other = accessions(b);
  return [...accessions(a)].some((x) => other.has(x));
};
const closedTogether = (a: StoredDeal, b: StoredDeal) => a.status === "Closed" && b.status === "Closed" && !!a.statusDate && a.statusDate === b.statusDate;
const nameInside = (a: string, b: string) => {
  const [x, y] = [normalizeName(a), normalizeName(b)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && ` ${long} `.includes(` ${short} `);
};

/**
 * Why two records are one deal stored under two names, or null. Every test needs a listed buyer or a filing in common, because a
 * serial buyer's deals look alike: Prosperity's two Texas banks of one day, Onfolio's and IonQ's purchases, CarGurus's two CarOffer stakes all stay apart.
 */
export function oneDeal(a: StoredDeal, b: StoredDeal): string | null {
  if (a.partOfTarget || b.partOfTarget) return null;
  const [privateA, privateB] = [!!a.privateTarget, !!b.privateTarget];
  if (privateA !== privateB) {
    const [copy, listed] = privateA ? [a, b] : [b, a];
    if (!listed.target.cik) return null;
    if (copy.acquirer.cik && Number(copy.acquirer.cik) === Number(listed.target.cik)) return null;
    // The private "target" is a listed company in its own filing's words (Baxter / "HILLROM", DoorDash / "Instacart").
    if (namedBuyer(copy, listed) && daysApart(copy, listed) <= 400 && filerCiks(copy).has(Number(listed.target.cik))) return "filed by the listed target";
    if (listedBuyer(copy, listed) && daysApart(copy, listed) <= 1 && nothingDiffers(copy, listed)) return "same buyer, same day, no figure differs";
    return null;
  }
  if (privateA && privateB) {
    if (!listedBuyer(a, b)) return null;
    // A holding company and the business it holds: Vroom / Unitas Holdings and United Auto Credit, both $300M.
    if (a.valueUsd != null && a.valueUsd === b.valueUsd && daysApart(a, b) <= 7) return "same stated value within a week";
    if (closedTogether(a, b) && a.consideration && b.consideration && nothingDiffers(a, b) && (daysApart(a, b) <= 2 || (shareFiling(a, b) && daysApart(a, b) <= 120))) return "closed the same day, same payment";
    if (closedTogether(a, b) && nameInside(a.target.name, b.target.name) && daysApart(a, b) <= 730) return "closed the same day, one name inside the other";
    return null;
  }
  // Two registrants trading as one (Crestwood Equity and Crestwood Midstream, both CEQP).
  if (listedBuyer(a, b) && a.target.cik !== b.target.cik && !!a.target.ticker && a.target.ticker.toUpperCase() === b.target.ticker?.toUpperCase() && daysApart(a, b) <= 14) return "same buyer and target ticker";
  return null;
}

const FILLED_FROM_THE_COPY = ["valueUsd", "pricePerShare", "premiumPct", "consideration", "enterpriseValueUsd", "evEbitda", "evEbitdaReported", "evRevenue", "valueKind"] as const;
function fillBlank<K extends keyof StoredDeal>(keep: StoredDeal, extra: StoredDeal, key: K) {
  if (keep[key] == null && extra[key] != null) keep[key] = extra[key];
}
const byFiledDate = (a: { filedDate: string }, b: { filedDate: string }) => a.filedDate.localeCompare(b.filedDate);

/** Folds a copy into the record that stays. A share-price figure moves only if it was measured around the announcement (a closing-day one parks). */
function fold(keep: StoredDeal, extra: StoredDeal) {
  if (!keep.acquirer.cik && extra.acquirer.cik && sameCompany(keep.acquirer.name, extra.acquirer.name)) keep.acquirer = { ...extra.acquirer };
  if (sameBuyer(keep.acquirer, extra.acquirer)) {
    const earlier = extra.announcedDate < keep.announcedDate && !extra.dateIsSigning;
    if (earlier && extra.reaction) {
      keep.reaction = extra.reaction;
      keep.reactionCheckedAt = extra.reactionCheckedAt;
    } else if (near(keep.announcedDate, extra.announcedDate)) keep.reaction ??= extra.reaction;
    if (keep.reaction) keep.reactionCheckedAt ??= extra.reactionCheckedAt;
  }
  const signingOnly = !!extra.dateIsSigning && daysApart(keep, extra) <= 5;
  if (extra.announcedDate < keep.announcedDate && !signingOnly) {
    keep.announcedDate = extra.announcedDate;
    delete keep.dateIsClosing;
    if (extra.dateIsSigning) keep.dateIsSigning = true;
    else delete keep.dateIsSigning;
  } else if (keep.dateIsSigning && !extra.dateIsSigning && extra.announcedDate > keep.announcedDate && daysApart(keep, extra) <= 5) {
    keep.announcedDate = extra.announcedDate;
    delete keep.dateIsSigning;
    if (extra.reaction && sameBuyer(keep.acquirer, extra.acquirer)) {
      keep.reaction = extra.reaction;
      keep.reactionCheckedAt = extra.reactionCheckedAt;
    }
  }
  for (const key of FILLED_FROM_THE_COPY) fillBlank(keep, extra, key);
  keep.targetAdvisors = [...new Set([...keep.targetAdvisors, ...extra.targetAdvisors])];
  keep.acquirerAdvisors = [...new Set([...keep.acquirerAdvisors, ...extra.acquirerAdvisors])].filter((bank) => !keep.targetAdvisors.includes(bank));
  for (const f of extra.filings) if (!keep.filings.some((x) => x.url === f.url)) keep.filings.push(f);
  keep.filings.sort(byFiledDate);
  keep.sources = [...new Set([...keep.sources, ...extra.sources])];
  if ((keep.status === "Announced" || keep.status === "Pending") && (extra.status === "Closed" || extra.status === "Terminated") && keep.privateTarget) {
    keep.status = extra.status;
    keep.statusDate = extra.statusDate;
  }
}

const documented = (d: StoredDeal) => (d.privateTarget ? 0 : 100) + d.sources.length + (d.valueUsd != null ? 2 : 0) + (d.premiumPct != null ? 1 : 0) + (d.acquirer.cik ? 1 : 0);

/** Merges one deal stored as two records. The better documented stays, under its id. */
export function mergeSplitRecords(deals: StoredDeal[]) {
  const made: { keep: StoredDeal; extra: StoredDeal; why: string }[] = [];
  const firstWord = (d: StoredDeal) => `n:${normalizeName(d.acquirer.name).split(" ")[0]}`;
  const groups = new Map<string, StoredDeal[]>();
  for (const d of deals) {
    const keys = new Set([firstWord(d), ...(d.acquirer.cik ? [`c:${d.acquirer.cik}`] : []), ...(d.acquirer.ticker ? [`t:${d.acquirer.ticker.toUpperCase()}`] : [])]);
    for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const gone = new Set<StoredDeal>();
  const tried = new Set<string>();
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        if (gone.has(a) || gone.has(b)) continue;
        const pair = [a.id, b.id].sort().join("|");
        if (tried.has(pair)) continue;
        tried.add(pair);
        const why = oneDeal(a, b);
        if (!why) continue;
        const [keep, extra] = documented(a) > documented(b) || (documented(a) === documented(b) && a.announcedDate <= b.announcedDate) ? [a, b] : [b, a];
        fold(keep, extra);
        gone.add(extra);
        made.push({ keep, extra, why });
      }
  }
  for (const d of gone) deals.splice(deals.indexOf(d), 1);
  return made;
}

/**
 * One deal read both ways round, where the "buyer" of a private target is the listed company being bought: Seacor buying "American Industrial
 * Partners" (Apollo / New Home too). The record whose target filed a proxy or tender response stays, unless it is a stock deal of the same stated
 * value: then the listed company is issuing the shares (JFB Construction merging in XTEND, "XTEND buying JFB"), and the private record stays with its status.
 */
export function reversedCopies(deals: StoredDeal[]) {
  const made: { keep: StoredDeal; extra: StoredDeal }[] = [];
  const proxyFirst = (d: StoredDeal) => /^(?:PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC14D9|SC TO-T)$/.test(d.milestones?.firstFiling?.form ?? "");
  for (const x of deals.filter((d) => !d.privateTarget && d.target.cik)) {
    const back = deals.find((y) => y.privateTarget && y.acquirer.cik === x.target.cik && sameCompany(y.target.name, x.acquirer.name) && daysApart(x, y) <= 180);
    if (!back || !proxyFirst(x)) continue;
    if (x.consideration === "Stock" && back.valueUsd != null && back.valueUsd === x.valueUsd) {
      back.status = x.status;
      back.statusDate = x.statusDate;
      back.filings = [...x.filings, ...back.filings].sort(byFiledDate);
      back.sources = [...new Set([...back.sources, ...x.sources])];
      back.acquirerAdvisors = [...new Set([...back.acquirerAdvisors, ...x.targetAdvisors])];
      back.targetAdvisors = [...new Set([...back.targetAdvisors, ...x.acquirerAdvisors])];
      deals.splice(deals.indexOf(x), 1);
      made.push({ keep: back, extra: x });
      continue;
    }
    for (const key of ["valueUsd", "consideration", "valueKind"] as const) fillBlank(x, back, key);
    x.sources = [...new Set([...x.sources, ...back.sources])];
    deals.splice(deals.indexOf(back), 1);
    made.push({ keep: x, extra: back });
  }
  return made;
}

export function tidyDeals(deals: StoredDeal[]): TidyResult {
  const result: TidyResult = { dropped: [], merged: 0, topped: 0, sanitized: 0 };
  const drop = (d: StoredDeal, reason: string) => {
    deals.splice(deals.indexOf(d), 1);
    result.dropped.push({ id: d.id, reason });
  };

  // Clean first, then judge: "Leading Loyalty Provider Punchh Inc." becomes "Punchh Inc." rather than being dropped.
  for (const d of [...deals]) {
    // Merger-arb spreads are gone from the site, and a record may still carry its raw Yahoo quote: the next save removes it.
    delete (d as StoredDeal & { arb?: unknown }).arb;
    const changed = sanitizeDeal(d);
    const why = junkReason(d);
    if (why) drop(d, why);
    else if (changed) result.sanitized++;
    if (!why) putReleaseFirst(d);
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
    // (Or a new public company by another name: "New Pubco and Sellers" over R1 RCM.)
    const newSelf = (/^New\s/i.test(d.acquirer.name) && d.acquirer.name.split(/\s+/)[1]?.toLowerCase() === firstWord) || /^New\s+(?:Pubco|Holdco|Parent)\b/i.test(d.acquirer.name);
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
  // A side without a CIK is matched by name (Whiting Petroleum as the unresolved "buyer" of Oasis, its own buyer).
  const isSide = (party: StoredDeal["acquirer"], other: StoredDeal["target"]) => (party.cik ? party.cik === other.cik : sameCompany(party.name, other.name));
  for (const a of listed) {
    for (const b of listed) {
      if (a === b || !deals.includes(a) || !deals.includes(b)) continue;
      if (!isSide(b.acquirer, a.target) || !isSide(a.acquirer, b.target) || Math.abs(days(a.announcedDate, b.announcedDate)) > 60) continue;
      if (proxyFirst(a) && !proxyFirst(b)) {
        drop(b, `same deal as ${a.id} with buyer and target swapped`);
        result.merged++;
      }
    }
  }

  // A listed company and an unlisted one recorded both ways round, once as a listed target and once as a private one. The
  // listed record is right when its target filed the target's merger proxy or tender response (Commure bought Augmedix);
  // otherwise the listed company was the buyer (MGP Ingredients bought Luxco). Only figures are carried over, never parties.
  for (const x of listed) {
    if (!deals.includes(x) || x.acquirer.cik) continue;
    const back = deals.find((y) => deals.includes(y) && y.privateTarget && y.acquirer.cik === x.target.cik && sameCompany(y.target.name, x.acquirer.name) && Math.abs(days(y.announcedDate, x.announcedDate)) <= 120);
    if (!back) continue;
    const [keep, extra] = proxyFirst(x) ? [x, back] : [back, x];
    for (const k of ["valueUsd", "consideration"] as const) if (keep[k] == null && extra[k] != null) (keep as unknown as Record<string, unknown>)[k] = extra[k];
    if (keep.valueKind == null) keep.valueKind = extra.valueKind;
    // The other record may already know the outcome (CohBar's termination of its Morphogenesis merger).
    if ((keep.status === "Announced" || keep.status === "Pending") && (extra.status === "Closed" || extra.status === "Terminated")) {
      keep.status = extra.status;
      keep.statusDate = extra.statusDate;
    }
    keep.sources = [...new Set([...keep.sources, ...extra.sources])];
    drop(extra, `same deal as ${keep.id} read backwards`);
    result.merged++;
  }

  // A rival bid read as a deal between the rivals: MKS and II-VI both bid for Coherent within days, and one filing made
  // "MKS → II-VI". A → B is dropped when B → C and A → C were announced within 30 days of it.
  for (const x of listed) {
    if (!deals.includes(x) || !x.target.cik) continue;
    const near = (d: StoredDeal) => Math.abs(days(d.announcedDate, x.announcedDate)) <= 30;
    const bBuys = deals.filter((d) => d !== x && near(d) && d.acquirer.cik === x.target.cik && d.target.cik);
    if (bBuys.some((y) => deals.some((z) => z !== x && z !== y && near(z) && z.target.cik === y.target.cik && isSide(x.acquirer, z.acquirer)))) {
      drop(x, `rival bids for the same target read as a deal between the bidders`);
      result.merged++;
    }
  }

  // The same buyer's private purchase recorded twice, months apart: its announcement and its completion under two
  // spellings ("Rotron Aero" / "Rotron Aerospace Ltd.", Gelnex once its description is cleaned off). Private deals
  // can take half a year to close, past the 60-day window below.
  const privates = deals.filter((d) => d.privateTarget).sort((a, b) => a.announcedDate.localeCompare(b.announcedDate));
  for (let i = 0; i < privates.length; i++) {
    for (let j = i + 1; j < privates.length && days(privates[i].announcedDate, privates[j].announcedDate) <= 365; j++) {
      const [a, b] = [privates[i], privates[j]];
      if (!deals.includes(a) || !deals.includes(b) || a.status === "Terminated") continue;
      // Or another spelling of the same name ("AdoreMe" / "Adore Me", "CNAPP Vendor Ermetic" / "Ermetic", "UDF IV" / "United
      // Development Funding IV"), which also picks the name to keep.
      const spelling = privateNameMatch(a.target.name, b.target.name);
      if (!(identicalNames(a.target.name, b.target.name) || namesExtend(a.target.name, b.target.name) || spelling)) continue;
      if (!(sameCompany(a.acquirer.name, b.acquirer.name) || (!!a.acquirer.cik && a.acquirer.cik === b.acquirer.cik))) continue;
      if (spelling) a.target.name = spelling;
      else if (b.target.name.length > a.target.name.length) a.target.name = b.target.name;
      merge(a, b);
      drop(b, `same purchase as ${a.id}`);
      result.merged++;
    }
  }

  // One deal stored under two names, and the same deal read both ways round with a listed buyer.
  for (const m of mergeSplitRecords(deals)) {
    result.dropped.push({ id: m.extra.id, reason: `same deal as ${m.keep.id}: ${m.why}` });
    result.merged++;
  }
  for (const m of reversedCopies(deals)) {
    result.dropped.push({ id: m.extra.id, reason: `same deal as ${m.keep.id} read backwards` });
    result.merged++;
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
        const sameBuyer = oneBuyer(earlier, later);
        if (sameBuyer && gap <= 60) {
          merge(earlier, later);
          drop(later, `duplicate of ${earlier.id}`);
          result.merged++;
          break;
        }
        // A rival buyer signing with the same listed target within four months topped the earlier agreement
        // (Optum over Option Care for Amedisys, MITER over Masonite for PGT): that agreement was terminated.
        // (Not a named part of the company, beside another buyer's deal for the rest: IAC and Gray each bought part of Meredith.)
        if (earlier.partOfTarget || later.partOfTarget) continue;
        // An agreement can't end after a rival has signed with the target: this date is the rival's (Frontier / Spirit read JetBlue's March 2024 termination, the "revival" rule having skipped July 2022's). Blank, not wrong.
        if (!sameBuyer && earlier.target.cik && earlier.status === "Terminated" && earlier.statusDate && earlier.statusDate > later.announcedDate) {
          earlier.statusDate = null;
          earlier.milestones = undefined;
          rereadTerms(earlier);
        }
        if (!sameBuyer && earlier.target.cik && gap > 0 && gap <= 120 && earlier.status !== "Terminated" && later.status !== "Terminated") {
          earlier.status = "Terminated";
          earlier.statusDate = later.announcedDate;
          // Re-derived on the next run with the termination date (the target's closing filings belong to the winner).
          earlier.milestones = undefined;
          rereadTerms(earlier);
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
          rereadTerms(earlier);
          result.topped++;
          break;
        }
      }
    }
    leaveTheWinnersProxy(group.filter((d) => deals.includes(d)));
  }
  return result;
}

/**
 * Enrichment read this deal's terms while it was open, so with no end date, and took the winner's proxy (MKS and Lumentum showed II-VI's
 * lenders and fees, Masonite MITER's reverse fee, Hudson Executive NCR's break fee). Blank until the next run re-reads them up to the end
 * date (the blanked milestones bring it into enrichment): tidy comes last, so a rebuild saves these blank. Netflix's own proxy, before its end date, is read again.
 */
function rereadTerms(d: StoredDeal): void {
  d.terms = undefined;
  d.termsCheckedAt = null;
}

/** Also the same when one names the other by its ticker ("UWMC" = UWM Holdings Corp): not a rival bid. */
const oneBuyer =(a: StoredDeal, b: StoredDeal) =>
  sameCompany(a.acquirer.name, b.acquirer.name) || (!!a.acquirer.cik && a.acquirer.cik === b.acquirer.cik) || isTickerOf(a.acquirer.name, b.acquirer) || isTickerOf(b.acquirer.name, a.acquirer);

/**
 * A topped deal can have no end date (Lockheed / Aerojet, Aya / Cross Country), so enrichment can't bound what it reads and
 * takes the newest proxy, the winner's. Records of one target, oldest first: a Terminated record gives up a proxy it shares
 * with a later buyer's, and what its timeline shows from that deal's announcement on. It stays marked as read, or the next
 * run would read the same proxy again. Only a Terminated record: Gray and IAC each bought part of Meredith, both closed, and
 * keep sharing theirs.
 */
function leaveTheWinnersProxy(group: StoredDeal[]): void {
  group.forEach((earlier, i) => {
    if (earlier.status !== "Terminated") return;
    const rivals = group.slice(i + 1).filter((d) => !oneBuyer(earlier, d) && !d.partOfTarget);
    const later = rivals[0];
    if (!later) return;
    if (earlier.fairnessAdsh && rivals.some((d) => d.fairnessAdsh === earlier.fairnessAdsh)) {
      earlier.fairness = earlier.proxySections = undefined;
      earlier.fairnessAdsh = earlier.meetingDate = null;
      earlier.fairnessCheckedAt ??= earlier.statusCheckedAt ?? earlier.announcedDate;
    }
    const m = earlier.milestones;
    if (m && !earlier.statusDate) {
      const theirs = (date: string | null | undefined) => !!date && date >= later.announcedDate;
      if (theirs(m.firstFiling?.date)) m.firstFiling = null;
      if (theirs(m.definitiveProxy)) m.definitiveProxy = null;
      if (theirs(m.voteHeld)) m.voteHeld = null;
      if (theirs(m.closed)) m.closed = null;
    }
  });
}

/** Acquirer name of a SPAC (blank-check company), out of scope as a buyer. */
export const SPAC_NAME =
  /\b(?:Acquisition|Merger|Growth Opportunit(?:y|ies))\s+(?:Corp(?:oration)?|Co|Company|Ltd|Limited|Inc)\b|\bCapital Corp\.?\s+[IVX]+\b|\bBlank Check\b/i;

/**
 * A single branded hotel bought by a lodging REIT is a property, not a company: "Residence Inn by Marriott Seattle
 * South/Renton", "Embassy Suites by Hilton South Jordan Salt Lake City" (Apple Hospitality).
 */
export const HOTEL_PROPERTY = /\bby\s+(?:Marriott|Hilton|Hyatt|IHG|Wyndham)\s+[A-Z]/;

/** A "private target" named only for an oil and gas basin is an asset purchase: "Crescent Energy to Acquire Eagle Ford Assets from Devon". */
export const BASIN_NAME =
  /^(?:the\s+)?(?:Eagle Ford|Permian|Delaware|Midland|Bakken|Williston|Marcellus|Utica|Haynesville|DJ|Denver-Julesburg|Uinta|Powder River|Anadarko|San Juan|Barnett|Austin Chalk|Gulf of Mexico|Appalachia|Appalachian|SCOOP|STACK)(?:\s+(?:Basin|Shale|Play|Region|Acreage|Assets|Properties|Position))*$/i;
