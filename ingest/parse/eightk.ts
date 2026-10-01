/**
 * Extract a merger from the legal "Item 1.01 Entry into a Material Definitive Agreement"
 * section of an 8-K. Catches deals announced without a press-release exhibit, and
 * names the parties through the agreement's defined terms ("Parent", "Merger Sub", "the Company").
 */
import { flatten } from "../text";
import type { Consideration } from "../../lib/types";
import { cleanPartyName, isPlausibleName, sameCompany } from "./names";
import { extractConsideration, extractValue, type ParsedPress, type PressContext } from "./press";

interface Entity {
  name: string;
  nick: string;
  /** Second defined term, e.g. (the "Company" or "Udemy"). */
  alias?: string;
  index: number;
}

/** The Item 1.01 section, or null if the 8-K doesn't describe a merger agreement. */
export function item101(text: string): string | null {
  const t = flatten(text);
  const start = t.search(/Item\s*1\.01\.?\s*Entry into (?:a )?Material Definitive Agreement/i);
  if (start < 0) return null;
  const rest = t.slice(start + 20);
  const end = rest.search(/Item\s*(?:1\.02|2\.0\d|3\.0\d|5\.0\d|7\.01|8\.01|9\.01)\b/i);
  // EDGAR HTML often pads defined terms: (the " Company ") -> (the "Company").
  const section = t.slice(start, start + 20 + (end > 0 ? end : 12_000)).replace(/["“]\s+([A-Z][^"”]{0,39}?)\s+["”]/g, '"$1"');
  if (!/Agreement and Plan of Merger|Merger Agreement|Arrangement Agreement|Plan of Arrangement/i.test(section)) return null;
  if (!/merge[ds]? with and into|merger of .{1,60} with and into|tender offer|exchange offer|plan of arrangement|amalgamat|be acquired by/i.test(section)) return null;
  return section;
}

/** Legal phrasing that shows a capture is a clause, not a company name. */
const CLAUSE = /\b(?:will|shall|with and into|Merger Agreement|Pursuant|Section|approved|effective time|continuing|surviving|thereof|thereunder|commence|if any|converted|Act of)\b/i;

/** Defined parties: `Acme Corp., a Delaware corporation ("Parent")`. */
export function definedEntities(s: string): Entity[] {
  const out: Entity[] = [];
  const re = /([A-Z][A-Za-z0-9&.,'’\- ]{1,90}?)(?:,\s*(?:an?|the)\s+[^()"“]{2,160}?)?\s*\(\s*(?:the\s+|each,\s+a\s+)?["“]([^"”]{1,40})["”](?:\s+or\s+["“]([^"”]+)["”])?\s*\)/g;
  for (const m of s.matchAll(re)) {
    let name = m[1].trim();
    // Drop leading clause words captured before the name:
    // "Merger On December 1, 2025, Keystone" -> "Keystone"; "with Copart" -> "Copart"; "Company, GlaxoSmithKline LLC" -> "GlaxoSmithKline LLC".
    name = name.replace(/^.*\b(?:19|20)\d{2},\s+(?=[A-Z])/, "");
    name = name.replace(/^.*\b(?:Agreement|thereof|hereof|Offer),\s+(?=[A-Z])/, "");
    name = name.replace(/^(?:the\s+)?(?:Company|Parent|Purchaser|Merger Sub),\s+(?=[A-Z])/, "");
    name = name.replace(/^(?:.*\b(?:with|and|among|between|by|of|that is affiliated with|affiliated with|subsidiary of)\s+)(?=[A-Z])/, "");
    // "Soleno Therapeutics, Inc. a Delaware corporation" -> "Soleno Therapeutics, Inc."
    name = name.replace(/,?\s+an?\s+[A-Z][\w.]*(?:\s[\w.]+){0,3}\s+(?:corporation|company|limited liability company|limited partnership|partnership|trust|société anonyme|public limited company)$/i, "");
    name = cleanPartyName(name.replace(/,$/, ""));
    if (!isPlausibleName(name) || name.length > 70 || CLAUSE.test(name)) continue;
    if (/^(?:the )?(?:Company|Parent|Merger Sub|Purchaser|Board|Effective Time|Offer|Merger|Share|Delaware)$/i.test(name)) continue;
    // "RTB's certificate of incorporation", "the Company's common stock": a possessive then lowercase words is a
    // document or security, never a company.
    if (/['’]s\s+[a-z]/.test(name)) continue;
    // Defined securities are not parties: holders of RTB's preferred stock (the "RTB Preferred Stock").
    if (/\b(?:Stock|Shares|Notes|Warrants|Units|Securities|Options|Consideration|Price)$/i.test(m[2].trim())) continue;
    // Nor are defined terms for the deal itself: ... merge with and into RTB (the "Merger").
    if (/^(?:Mergers?|Transactions?|Offer|Closing|Effective Time|(?:Merger )?Agreement|Surviving Corporation)$/i.test(m[2].trim())) continue;
    out.push({ name, nick: m[2].trim(), alias: m[3]?.trim(), index: m.index! });
  }
  return out;
}

const SUB_NICK = /^(?:Merger Sub(?:\s*\d)?|Purchaser|Merger Subsidiary|MergeCo|Acquisition Sub|Sub)$/i;
const SHELL_NAME = /\b(?:Merger Sub|MergeCo|Merger Corp|Bidco|BidCo|Topco|Midco|Holdco|Purchaser|Acquisition (?:Corp|Co|LLC|Inc))\b/;
const BUYER_NICKS = ["Ultimate Parent", "Guarantor", "Parent", "Buyer", "Acquiror", "Acquirer", "Holdings", "Topco"];

/** Price per target share: "right to receive $42.15 in cash", "for $10.50 per share, net to the seller in cash". */
export function extractMergerPrice(s: string): number | null {
  const m =
    /right to receive(?:[^$;.]{0,80}?)\$\s?(\d{1,4}(?:\.\d{1,4})?)\s*(?:in cash|per share|,? without interest|\(the)/i.exec(s) ??
    /(?:for|at a price of|offer price of)\s+\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+per\s+share\b[^.;$]{0,80}?(?:net to the (?:seller|holder)|in cash)/i.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 0.05 && v < 10_000 ? v : null;
}

/**
 * Which party disappears (the target) and which survives, from the merger mechanics:
 *  - "Merger Sub / Purchaser ... will (be) merge(d) with and into X"   -> target X
 *  - "the merger of Merger Sub with and into X"                          -> target X
 *  - "Y will merge with and into X" (Y a named party)                    -> target Y, acquirer X
 *  - "the Company will be acquired by X"                                  -> target Company, acquirer X
 */
function mechanics(section: string, entities: Entity[]): { target: string; acquirerHint?: string } | null {
  const ref = (s: string) => s.replace(/^the\s+/i, "").replace(/[.,;]+$/, "").trim();
  for (const m of section.matchAll(/\b(?:will|shall)\s+(?:be\s+)?merge[ds]?\s+with\s+and\s+into\s+(?:the\s+)?"?([A-Z][\w&.'’\-]*(?:\s[A-Z][\w&.'’\-]*){0,3}?)"?(?=[\s,.(;])/g)) {
    const into = ref(m[1]);
    const before = section.slice(Math.max(0, m.index! - 260), m.index!);
    if (/Merger Sub|Purchaser|MergeCo|Merger Subsidiary|Acquisition (?:Co|Corp|Sub)|Merger Corp/i.test(before.slice(-160))) return { target: into };
    // A named party merging directly into another (bank mergers): the named party is the target.
    const subject = [...entities].reverse().find((e) => before.slice(-140).includes(e.nick) || before.slice(-140).includes(e.name));
    if (subject && !sameCompany(subject.name, into) && subject.nick !== into) return { target: subject.nick, acquirerHint: into };
  }
  const mergerOf = /merger of (?:the\s+)?(?:Merger Sub|Purchaser|[A-Z][\w ]{1,30}?Sub)\s+with\s+and\s+into\s+(?:the\s+)?"?([A-Z][\w&.'’\-]*(?:\s[A-Z][\w&.'’\-]*){0,3}?)"?(?=[\s,.(;])/.exec(section);
  if (mergerOf) return { target: ref(mergerOf[1]) };
  const acquiredBy = /(?:the\s+)?(Company|[A-Z][\w&.'’\-]+)\s+will\s+be\s+acquired\s+by\s+([A-Z][^(,]{1,60}?)(?=\s*\(|,)/.exec(section);
  if (acquiredBy) return { target: ref(acquiredBy[1]), acquirerHint: acquiredBy[2].trim() };
  if (/tender offer|exchange offer/i.test(section)) {
    // "...to acquire all of Bluebird's outstanding shares" / "...all of the outstanding shares of common stock ... of the Company"
    const owner =
      /(?:acquire|purchase)\s+(?:any and\s+)?all\s+(?:of\s+)?(?:the\s+)?(?:issued and\s+)?(?:outstanding\s+)?(?:shares\b[^.;]{0,120}?\bof\s+(?:the\s+)?)?"?([A-Z][\w&.'’\-]*(?:\s[A-Z][\w&.'’\-]*){0,3}?)(?:['’]s)?"?(?=[\s,.(;])/.exec(section);
    const t = owner ? ref(owner[1].replace(/['’]s$/, "")) : "";
    if (t && (/^Company$/i.test(t) || entities.some((e) => e.nick === t || e.alias === t || sameCompany(e.name, t)))) return { target: t };
    if (entities.some((e) => /^Company$/i.test(e.nick))) return { target: "Company" };
  }
  return null;
}

export function parseMergerItem(text: string, ctx: PressContext): ParsedPress | null {
  const section = item101(text);
  if (!section) return null;
  const opening = section.slice(0, 3000);
  const entities = definedEntities(opening);
  const byRef = (ref: string) =>
    entities.find((e) => e.nick.toLowerCase() === ref.toLowerCase() || e.alias?.toLowerCase() === ref.toLowerCase()) ?? entities.find((e) => sameCompany(e.name, ref));

  const mech = mechanics(section, entities);
  if (!mech) return null;
  const companyEntity = entities.find((e) => /^Company$/i.test(e.nick));
  let targetName = /^Company$/i.test(mech.target) ? (companyEntity?.name ?? ctx.filerName) : (byRef(mech.target)?.name ?? (isPlausibleName(mech.target) ? mech.target : null));
  if (!targetName) return null;
  // A merger subsidiary is never the target: the mechanics were read backwards, so the Company is.
  if (SHELL_NAME.test(targetName)) {
    targetName = companyEntity?.name ?? ctx.filerName;
    mech.acquirerHint = undefined;
    mech.target = "Company";
  }
  const isTarget = (e: Entity) =>
    sameCompany(e.name, targetName) || e.nick.toLowerCase() === mech.target.toLowerCase() || e.alias?.toLowerCase() === mech.target.toLowerCase();

  // Buyer: an explicit hint from the mechanics, else the entity defined as (Ultimate) Parent / Buyer,
  // else the first named party that isn't the target or a merger subsidiary, else the filer.
  let buyer: Entity | undefined;
  if (mech.acquirerHint) buyer = byRef(mech.acquirerHint) ?? { name: cleanPartyName(mech.acquirerHint), nick: mech.acquirerHint, index: 0 };
  for (const nick of BUYER_NICKS) {
    if (buyer) break;
    buyer = entities.find((e) => e.nick.toLowerCase() === nick.toLowerCase() && !isTarget(e));
  }
  buyer ??= entities.find((e) => !isTarget(e) && !SUB_NICK.test(e.nick) && !SHELL_NAME.test(e.name) && !/^Company$/i.test(e.nick));
  if (!buyer && !sameCompany(ctx.filerName, targetName)) buyer = { name: ctx.filerName, nick: "Company", index: 0 };
  if (!buyer) return null;

  // Prefer an ultimate parent / named sponsor over a shell buyer ("Sword Purchaser, LLC ... affiliated with CD&R").
  let acquirerName = buyer.name;
  const ultimate = entities.find((e) => /^(?:Ultimate Parent|Guarantor)$/i.test(e.nick) && !isTarget(e));
  if (ultimate && ultimate !== buyer) acquirerName = ultimate.name;
  else if (SHELL_NAME.test(buyer.name) || /^(?:[A-Z][A-Za-z]+ )+(?:Parent|Purchaser|Holdings|Buyer|Bidco|BidCo)\b/.test(buyer.name)) {
    const after = section.slice(buyer.index, buyer.index + 400);
    const lead = /(?:affiliated with|an affiliate of|affiliates of|a (?:wholly owned )?subsidiary of|controlled by|formed by|owned by)\s+(?:(?:investment )?funds? (?:managed|advised) by\s+)?/.exec(after) ?? /(?:investment )?funds? (?:managed|advised) by\s+/.exec(section);
    if (lead) {
      const src = lead.input;
      const rest = src.slice(lead.index + lead[0].length);
      const sponsor = /^([A-Z][^()"“;]{1,80}?)\s*\(/.exec(rest) ?? /^([A-Z][A-Za-z0-9&.'’\- ]{1,80}?)(?=,|\.\s|;|\s(?:and|or)\s)/.exec(rest);
      if (sponsor && !CLAUSE.test(sponsor[1])) acquirerName = cleanPartyName(sponsor[1]);
    }
  }
  if (!isPlausibleName(acquirerName) || sameCompany(acquirerName, targetName) || /^(?:Parent|Purchaser|Buyer|Company|Merger Sub)$/i.test(acquirerName)) return null;

  const consideration: Consideration | null = extractConsideration(section.slice(0, 5000));
  const value = extractValue(section);
  return {
    kind: "announcement",
    headline: `${acquirerName} to acquire ${targetName} (8-K Item 1.01)`,
    acquirer: { name: acquirerName, ticker: null, exchange: null },
    target: { name: targetName, ticker: null, exchange: null },
    pricePerShare: extractMergerPrice(section),
    premiumPct: null,
    valueUsd: value?.usd ?? null,
    valueKind: value?.kind ?? null,
    consideration,
    acquirerAdvisors: [],
    targetAdvisors: [],
  };
}
