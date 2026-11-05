/**
 * Buyers' share-price reactions (`Deal.reaction`) are a closed study. They came from Yahoo Finance's chart endpoint until
 * November 2026, when Castle stopped calling it: Yahoo's terms bar collecting its data by automated means without
 * permission, and no free source allows it. So a figure that is lost can't be fetched again, and a rebuild, which forgets
 * every deal, has to hand each one on to the deal's new record.
 *
 * A reaction is about one buyer's shares, so it moves only to a record of the same deal with the same buyer. An id alone
 * doesn't prove that: ids are target + date, so a rival announcing that day, or a buyer the parsers now read differently
 * (a buyout firm once linked to a listed company of the same name), can hold the same one.
 */
import { cleanPartyName, normalizeName, notTheSponsor } from "./parse/names";
import type { StoredDeal } from "./store";

/** A stored reaction and what it takes to find its deal again. */
export type HeldReaction = Pick<StoredDeal, "id" | "announcedDate" | "acquirer" | "target" | "reaction" | "reactionCheckedAt">;

const DAY = 86_400_000;
/** Announcement dates can move a few days between readings (the release or the signing 8-K). */
const MAX_DAYS_APART = 7;

/** The reactions among these deals, cut down to what `carryReactions` needs. */
export function heldReactions(deals: StoredDeal[]): HeldReaction[] {
  return deals.filter((d) => d.reaction).map(({ id, announcedDate, acquirer, target, reaction, reactionCheckedAt }) => ({ id, announcedDate, acquirer, target, reaction, reactionCheckedAt }));
}

/**
 * Everything a run has to keep hold of: every reaction on a record, since any run can drop or merge a record, not only a
 * rebuild, and what earlier runs parked. Once each: a failed rebuild leaves a figure both on its old row and in the parked list.
 */
export function reactionsToHold(deals: StoredDeal[], parked: HeldReaction[]): HeldReaction[] {
  const seen = new Set<string>();
  return [...heldReactions(deals), ...parked].filter((h) => {
    const key = `${h.id}|${h.acquirer.cik ?? normalizeName(h.acquirer.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The same buyer: the same CIK or the same ticker (a listed company can have two registrants, Merck & Co. and Merck Sharp &
 * Dohme, and the shares are the same MRK), else the same name once its legal form is gone. Never a loose match: a reaction is
 * one company's share move, and General Motors isn't General Electric, nor EQT Corp the fund EQT Infrastructure. A name
 * alone can't tell a registrant from the buyout firm that shares it ("Advent"), hence the second check. Refusing costs
 * little: the figure stays parked until the buyer is linked.
 */
export function sameBuyer(a: HeldReaction["acquirer"], b: HeldReaction["acquirer"]): boolean {
  if (a.ticker && b.ticker && a.ticker.toUpperCase() === b.ticker.toUpperCase()) return true;
  if (a.cik && b.cik) return a.cik === b.cik;
  const name = normalizeName(a.name);
  return !!name && name === normalizeName(b.name) && !notTheSponsor(a.name, b.name) && !notTheSponsor(b.name, a.name);
}

// Compared once cleaned, as tidy will clean it ("IGY Marinas Significantly", "Westfield Jointly").
const targetName = (n: string) => normalizeName(cleanPartyName(n));
const sameTarget = (a: HeldReaction["target"], b: HeldReaction["target"]) => {
  if (a.cik && b.cik) return a.cik === b.cik;
  const name = targetName(a.name);
  return !!name && name === targetName(b.name);
};

export const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= MAX_DAYS_APART * DAY;

/**
 * Hands each reaction in `old` on to its deal's record in `next`: the same id with the same buyer, else the same buyer
 * (by CIK or ticker) and the same target announced within a week. Further than a week it stays parked: a figure measured
 * from the wrong day is no announcement reaction, and blank is better than wrong. Never overwrites a reaction already
 * there, so it is safe to repeat. No I/O; it fills in `next`'s records in place, since the run is still working on them.
 * `unplaced` is what found no record, for a later run to try again.
 */
export function carryReactions(old: HeldReaction[], next: StoredDeal[]): { carried: number; unplaced: HeldReaction[] } {
  const byId = new Map(next.map((d) => [d.id, d]));
  const buyerKeys = (a: HeldReaction["acquirer"]) => [a.cik ? `c:${a.cik}` : null, a.ticker ? `t:${a.ticker.toUpperCase()}` : null].filter((k): k is string => !!k);
  const byBuyer = new Map<string, StoredDeal[]>();
  for (const d of next) for (const k of buyerKeys(d.acquirer)) byBuyer.set(k, [...(byBuyer.get(k) ?? []), d]);
  // A record whose buyer isn't linked yet (a registrant renamed since: Gray Television, today Gray Media) is found through its target.
  const targetKey = (t: HeldReaction["target"]) => (t.cik ? `c:${t.cik}` : `n:${targetName(t.name)}`);
  const byTarget = new Map<string, StoredDeal[]>();
  for (const d of next) byTarget.set(targetKey(d.target), [...(byTarget.get(targetKey(d.target)) ?? []), d]);

  let carried = 0;
  const unplaced: HeldReaction[] = [];
  for (const held of old) {
    if (!held.reaction) continue;
    const sameId = byId.get(held.id);
    const sameDeal = sameId && sameBuyer(held.acquirer, sameId.acquirer) ? sameId : null;
    // Its date has moved further than that: the figure was measured around another day (a closing), so it leaves the
    // record, and may park. Repeatable: only the figure it held, and on the next save the record no longer holds it.
    // So too a record still dated at its closing, whatever its id: the release says the deal was announced earlier, and this isn't that day's reaction.
    if (sameDeal && (!near(held.announcedDate, sameDeal.announcedDate) || sameDeal.dateIsClosing) && JSON.stringify(sameDeal.reaction) === JSON.stringify(held.reaction)) {
      delete sameDeal.reaction;
      delete sameDeal.reactionCheckedAt;
    }
    const record =
      sameDeal && near(held.announcedDate, sameDeal.announcedDate)
        ? sameDeal
        : [...buyerKeys(held.acquirer).flatMap((k) => byBuyer.get(k) ?? []), ...(byTarget.get(targetKey(held.target)) ?? []).filter((d) => sameBuyer(held.acquirer, d.acquirer))].find((d) => sameTarget(held.target, d.target) && near(held.announcedDate, d.announcedDate));
    if (!record || record.dateIsClosing) {
      unplaced.push(held);
      continue;
    }
    if (record.reaction) continue;
    record.reaction = held.reaction;
    if (held.reactionCheckedAt) record.reactionCheckedAt = held.reactionCheckedAt;
    // The figure's buyer was linked; a record that lost the link by name gets it back.
    record.acquirer.cik ??= held.acquirer.cik;
    record.acquirer.ticker ??= held.acquirer.ticker;
    carried++;
  }
  // One figure, one place. Unplaced, but the same buyer's record of about that day holds the very figure: that deal under another name (UBP =
  // Urstadt Biddle), nothing to park. A record dated further off holds a figure from the wrong day (Fincastle's closing-day figure on the February
  // record): it leaves the record and stays parked.
  const same = (a: HeldReaction, d: StoredDeal) => !!d.reaction && JSON.stringify(d.reaction) === JSON.stringify(a.reaction) && sameBuyer(a.acquirer, d.acquirer);
  const parked: HeldReaction[] = [];
  for (const h of unplaced) {
    const holders = [...buyerKeys(h.acquirer).flatMap((k) => byBuyer.get(k) ?? []), ...(byTarget.get(targetKey(h.target)) ?? [])].filter((d) => same(h, d));
    if (holders.some((d) => near(h.announcedDate, d.announcedDate))) continue;
    for (const d of holders) {
      delete d.reaction;
      delete d.reactionCheckedAt;
    }
    parked.push(h);
  }
  return { carried, unplaced: parked };
}
