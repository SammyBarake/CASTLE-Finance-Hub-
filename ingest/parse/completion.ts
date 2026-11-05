/**
 * A buyer's own later filings saying a private purchase closed or ended: "On March 21, 2022, we completed the
 * acquisition of Linode", "Intel … terminated its agreement to acquire Tower Semiconductor". Most private
 * acquisitions get no 8-K Item 2.01, so without this they stayed "Announced" for years (DoorDash / Wolt, Aon / NFP).
 *
 * Pure: the phrases to search for, and a reader that checks the sentence is a plain statement (not "if", "may",
 * "expected to") and takes the date only when the sentence states one.
 */

const MONTH = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const PREVIOUSLY = ["", "previously announced ", "previously disclosed "];

/** Past-tense wording a buyer uses once a purchase has closed ("completed its previously announced acquisition of X"). */
export const completedPhrases = (name: string) => [
  ...["completed the", "completed its", "completed our", "closed the", "closed its", "closed our"].flatMap((v) => PREVIOUSLY.map((p) => `${v} ${p}acquisition of ${name}`)),
  `we acquired ${name}`,
  `the Company acquired ${name}`,
];

/** Wording for a purchase called off ("to terminate its previously disclosed agreement to acquire Tower"). */
export const endedPhrases = (name: string) => [
  ...["terminated the", "terminated its", "terminate the", "terminate its"].flatMap((v) => PREVIOUSLY.map((p) => `${v} ${p}agreement to acquire ${name}`)),
  `terminated the merger agreement with ${name}`,
  `termination of the merger agreement with ${name}`,
];

/** A short form to search too: the first word of a two-word-plus name, five letters or more ("Tower Semiconductor" → "Tower"). */
export function shortName(name: string): string | null {
  const words = name.split(/\s+/);
  return words.length >= 2 && /^[A-Z][a-z]{4,}$/.test(words[0]) ? words[0] : null;
}

/** The core of a private company's name for searching: no legal suffix ("Avitide Inc." → "Avitide"). */
export function searchName(name: string): string | null {
  const core = name.replace(/,?\s+(?:Inc|LLC|L\.L\.C|Ltd|Limited|Corp|Corporation|Co|Company LLC|L\.?P|plc|S\.A|N\.V|B\.V|GmbH|AG|Oy|AB|SAS)\.?$/i, "").trim();
  // Too short or generic to search for on its own ("Joh", "Home Health", "Privately Held"); an acronym in capitals is a
  // name ("NFP": Aon's 10-Q says "completed the acquisition of NFP").
  // (A brand may start in lower case: mGage, aiXscale, iSun. A capital somewhere, or a digit first: 1st Colonial.)
  if ((core.length < 4 && !/^[A-Z]{3}$/.test(core)) || !/[A-Z]/.test(core) || /^(?:the|an?|our|its)\s/.test(core) || /^(?:privately held|home health|consumer experience|the company)$/i.test(core)) return null;
  return core;
}

/**
 * A completed purchase referred to by its month: "our May 2022 acquisition of Wolt Enterprises Oy" (DoorDash's 10-Q,
 * which never says "completed the acquisition of Wolt"). Found, but undated: the day isn't stated.
 */
export function readPastReference(text: string, name: string): CompletionRead {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`\\b(?:our|its)\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{4}\\s+acquisition\\s+of\\s+${esc}\\b`, "i").test(text.replace(/\s+/g, " "));
  return { found, date: null, today: false };
}

// ("may", not the month: "On May 31, 2022, we completed …" looked conditional, which hid every closing dated in May.)
const CONDITIONAL = /\b(?:if|may(?!\s+\d)|might|could|would|will|shall|expects?|expected|anticipates?|anticipated|intends?|plans?|right to|option to|upon|until|unless|whether|pending|proposed)\b/i;

export interface CompletionRead {
  /** The statement was found as a plain past-tense sentence. */
  found: boolean;
  /** ISO date the sentence states for it ("On March 21, 2022, …", "… on March 21, 2022"), if any. */
  date: string | null;
  /** The sentence says it happened "today": a release dated by its filing ("announced today that it has completed …"). */
  today: boolean;
}

/**
 * Find one of `phrases` in `text` and read its sentence. Words such as "if", "may" or "expected" before the phrase
 * make it conditional, so it doesn't count. The date must be stated in the same sentence.
 */
export function readStatement(text: string, phrases: string[]): CompletionRead {
  const flat = text.replace(/\s+/g, " ");
  const lower = flat.toLowerCase();
  for (const p of phrases) {
    let at = lower.indexOf(p.toLowerCase());
    while (at >= 0) {
      const dot = flat.lastIndexOf(". ", at);
      const start = Math.max(dot < 0 ? 0 : dot + 2, at - 400, 0);
      const endDot = flat.indexOf(". ", at + p.length);
      const sentence = flat.slice(start, endDot < 0 ? at + p.length + 300 : Math.min(endDot, at + p.length + 300));
      const before = flat.slice(start, at);
      // "today" before the phrase ("today announced that it has completed the acquisition of X"), not after it ("… earlier today", about another deal: Kaltura).
      if (!CONDITIONAL.test(before)) return { found: true, date: statedDate(sentence), today: /\btoday\b/i.test(before) };
      at = lower.indexOf(p.toLowerCase(), at + 1);
    }
  }
  return { found: false, date: null, today: false };
}

const LOOSE_GUARD = /\b(?:if|may(?!\s+\d)|might|could|would|will|shall|expects?|expected|anticipates?|anticipated|intends?|plans?|right to|option to|upon|until|unless|whether|pending|proposed|not|assum\w+|as though|pro forma|prior to|before|following)\b/i;
const PERCENT = String.raw`\d{1,3}(?:\.\d+)?\s?%`;
const DEAL_WORD = String.raw`(?:acquisitions?|purchase|merger|combination|buyout)`;
const DONE_THEN_DEAL = new RegExp(String.raw`\b(?:completed|closed|consummated|finali[sz]ed)\b[^.;]{0,100}?\b${DEAL_WORD}\b[^.;]{0,70}$`, "i");
// The name as a term the sentence defines: "the acquisition of certain subsidiaries … of Harris Freeman & Co, Inc. ("Harris Tea")".
const DONE_THEN_TERM = new RegExp(String.raw`\b(?:completed|closed|consummated|finali[sz]ed)\b[^;]{0,100}?\b${DEAL_WORD}\b[^;]{0,150}\(\s*(?:the\s+)?["“]\s*$`, "i");
const ANNOUNCED_DONE = /\bannounced the (?:successful )?(?:completion|closing)\b[^.;]{0,100}$/i;
const ACQUIRED_ALL = new RegExp(String.raw`\b(?:acquired|purchased)\s+(?:(?:all|substantially all|the remaining|the entire|a (?:majority|controlling))\b|(?:an?\s+)?${PERCENT})(?:[^.;]{0,90}$|[^;]{0,130}\(\s*(?:the\s+)?["“]\s*$)`, "i");
const ON_A_DAY_ACQUIRED = /^\s*(?:On|Effective|As of)\s+[A-Z][a-z]+\s+\d{1,2},\s*\d{4},[^.;]{0,110}\b(?:acquired|purchased)\s+(?:the\s+)?$/;
// "we acquired 30 retail tire and automotive repair stores … from Mountain View Tire & Service", "we acquired Turbine Controls, Inc. on April 24, 2024 and Kellstrom Aerospace Group". Not a licence.
const WE_ACQUIRED = /\b(?:we|the Company)\s+acquired\b(?:(?!\b(?:licen[cs]es?|rights?|options?)\b)(?:[^.;]|\.(?=\s+[a-z]))){0,110}$/i;
const DEAL_OF_NAME = new RegExp(String.raw`\b(?:acquisitions?|purchase|merger)\s+(?:of|with)\s+(?:(?:the|its)\s+|${PERCENT}\s+of\s+)?$`, "i");
const NAME_THEN_DONE = /^[^.;]{0,50}?\b(?:was|were|has been|had been)\s+(?:completed|closed|consummated|finali[sz]ed)\b/i;
const NAME_THEN_WHICH = /^[^.;]{0,50}?,?\s+which\s+(?:(?:we|was|the Company)\s+(?:completed|closed|consummated)|was\s+acquired\s+on)\b/i;
const NAME_DEAL_DONE = /^(?:\s+[A-Z][\w&-]*){0,3}\s+(?:acquisition|purchase|merger|transaction)\s+(?:was|were|has been|had been)\s+(?:completed|closed|consummated)\b/i;
// A price "net of cash acquired" is only known once it's done: "the acquisition of 100% of TTTech Auto for $766 million in cash ($679 million net of cash acquired)".
const NET_OF_CASH = /^(?:[^.;]|\.(?=\s+[a-z])){0,130}\bnet of cash acquired\b/i;
const ACQUISITIONS_OF = /\bacquisitions? of\s+(?:[^.;]{0,50})$/i;
const ENDED_DEAL = /\bterminat(?:ed|ion of)\b[^.;]{0,120}\b(?:purchase|merger|exchange|acquisition|combination)\s+agreement\b/i;
const NOT_A_NAME_TERM = /^(?:the\s+)?(?:Company|Seller|Sellers|Target|Merger|Mergers|Agreement|Acquisition|Transaction|Transactions|Purchase|Closing|Buyer|Purchaser|Parent|Sub|Merger Sub|Business|Assets|Shares|Interests|Group|Bank|Holdings)$/i;

const NOT_A_SENTENCE_END = /\b(?:Inc|Corp|Co|Ltd|LLC|L\.P|LP|N\.A|U\.S|No|Mr|Ms|Dr|St|S\.A|N\.V|B\.V|Plc|PLC)$/;
const sentenceAround = (flat: string, at: number, length: number) => {
  let dot = flat.lastIndexOf(". ", at);
  while (dot > 0 && NOT_A_SENTENCE_END.test(flat.slice(Math.max(0, dot - 6), dot))) dot = flat.lastIndexOf(". ", dot - 1);
  const start = Math.max(dot < 0 ? 0 : dot + 2, at - 400, 0);
  let end = flat.indexOf(". ", at + length);
  while (end > 0 && NOT_A_SENTENCE_END.test(flat.slice(Math.max(0, end - 6), end))) end = flat.indexOf(". ", end + 1);
  return { start, end: end < 0 ? at + length + 300 : Math.min(end, at + length + 300) };
};
// (Any case for a brand with capitals inside it, which filings write several ways: CleanLASER, cleanLASER. Never an ordinary word: "Own", "Direct".)
const nameRegex = (name: string) => new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, /[a-z][A-Z]|[A-Z]{3}/.test(name) ? "gi" : "g");

/**
 * The forms of a stored name a filing may use, for searching and reading: the name; without a trailing generic word ("E&I Engineering Group" is "E&I
 * Engineering Ireland Limited", "Park Holidays UK" is "Park Holidays"); the first of two named together ("Beacon and Blackstone's Bistro", "Lone Star
 * and Lone Star Bank", "Tug Hill and XcL Midstream"); before a comma ("Pacific Enterprise Bancorp, Irvine, California"); a brand in capitals ("GHOST").
 */
export function nameForms(name: string): string[] {
  const out = [name];
  const add = (n: string | undefined) => {
    const t = n?.trim();
    if (t && t.length >= 4 && /[A-Z]/.test(t) && !/^(?:the|an?|our|its)\s/i.test(t) && !out.includes(t)) out.push(t);
  };
  add(name.split(",")[0]);
  add(name.replace(/\s+(?:Group|Holdings?|Company|Corporation|Corp|UK|USA|US|Partners|International|Global|LLC|Inc|Ltd|Limited|SCA|S\.C\.A|SA|AG|GmbH|BV|NV|Oy|AB)\.?$/i, ""));
  add(name.includes(" & ") ? name.replace(" & ", " and ") : undefined);
  add(/^(.+?)\s+(?:and|&)\s+[A-Z]/.exec(name)?.[1]);
  add(/^([A-Z]{5,})\s+[A-Z][a-z]/.exec(name)?.[1]);
  return out;
}

function saysDone(before: string, after: string): boolean {
  if (LOOSE_GUARD.test(before)) return false;
  return (
    DONE_THEN_DEAL.test(before) ||
    DONE_THEN_TERM.test(before) ||
    ANNOUNCED_DONE.test(before) ||
    ACQUIRED_ALL.test(before) ||
    ON_A_DAY_ACQUIRED.test(before) ||
    WE_ACQUIRED.test(before) ||
    (DEAL_OF_NAME.test(before) && (NAME_THEN_DONE.test(after) || NAME_THEN_WHICH.test(after))) ||
    NAME_THEN_WHICH.test(after) ||
    NAME_DEAL_DONE.test(after) ||
    (ACQUISITIONS_OF.test(before) && NET_OF_CASH.test(after))
  );
}

/**
 * The other ways a buyer's annual and quarterly reports say a purchase closed, read only when the exact phrases found nothing: "we completed the
 * acquisition of a 55% interest in Teraco", "acquired all outstanding stock of Own Data Company", "On October 1, 2024, Flex acquired Crown Technical
 * Systems", "the acquisition of Westchester was completed". The sentence must say it in the past tense with no "if", "expected" or "pro forma" before
 * the name, and the deal word and the name must be close: a looser test reads other deals as this one. Also by the term the report defines for the
 * name ("All American Medical Group ("AAMG")", then "acquired 100% of the equity interest in AAMG").
 */
export function readLooseCompletion(text: string, name: string): CompletionRead {
  const flat = text.replace(/\s+/g, " ");
  const forms = nameForms(name);
  for (const form of forms) {
    const term = new RegExp(`(?<![\\w-])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^()"“”]{0,40}\\(\\s*(?:the\\s+)?["“]\\s*([^"”]{2,30}?)\\s*["”]\\s*\\)`).exec(flat)?.[1];
    if (term && /^[A-Z]/.test(term) && !NOT_A_NAME_TERM.test(term) && !forms.includes(term)) forms.push(term);
  }
  for (const form of forms) {
    for (const m of flat.matchAll(nameRegex(form))) {
      const { start, end } = sentenceAround(flat, m.index, form.length);
      if (saysDone(flat.slice(start, m.index), flat.slice(m.index + form.length, end))) {
        // Only a day stated close by, not "as of": "As of December 31, 2024" in the table run into this sentence is a balance sheet's (Flex / Crown).
        const near = flat.slice(Math.max(start, m.index - 240), Math.min(end, m.index + form.length + 120)).replace(/\bas of\b/gi, " ");
        return { found: true, date: statedDate(near), today: false };
      }
    }
  }
  return { found: false, date: null, today: false };
}

/** A purchase called off, in a report's words: "On June 1, 2024, we terminated the Stock Purchase Agreement for Votaw". A sentence naming the company, a merger or purchase agreement and its end, not conditionally. */
export function readLooseEnd(text: string, name: string): CompletionRead {
  const flat = text.replace(/\s+/g, " ");
  for (const form of nameForms(name)) {
    for (const m of flat.matchAll(nameRegex(form))) {
      const { start, end } = sentenceAround(flat, m.index, form.length);
      const sentence = flat.slice(start, end);
      if (ENDED_DEAL.test(sentence) && !CONDITIONAL.test(sentence.slice(0, sentence.search(ENDED_DEAL)))) return { found: true, date: statedDate(sentence), today: false };
    }
  }
  return { found: false, date: null, today: false };
}

const TO_BUY = /\b(?:to|will)\s+(?:acquire|purchase|buy|merge with|combine with)\b[^.;]{0,60}$/i;
const UNDER_AGREEMENT = /\b(?:entered into|enters into|signed|signs|executed|announc\w+|reached)\b[^.;]{0,80}\b(?:definitive|merger|purchase|sale|acquisition)\s+agreement\b[^.;]{0,140}$/i;
const NOT_THE_NEWS = /\b(?:completed|completion|closed|consummated|terminated|termination|previously|letters? of intent|non-?binding|indications? of interest|proposal)\b/i;

/**
 * Does this 8-K announce the purchase of the named company? "CURO Group to Acquire First Heritage Credit", "has entered into a definitive agreement
 * to acquire Sunshine Fitness". Not a sentence saying it closed, ended, was announced before or is only a letter of intent.
 */
export function readAnnouncement(text: string, name: string): boolean {
  const flat = text.replace(/\s+/g, " ").slice(0, 12_000);
  for (const form of nameForms(name)) {
    for (const m of flat.matchAll(nameRegex(form))) {
      const { start, end } = sentenceAround(flat, m.index, form.length);
      if (NOT_THE_NEWS.test(flat.slice(start, end))) continue;
      const before = flat.slice(start, m.index);
      if (TO_BUY.test(before) || UNDER_AGREEMENT.test(before) || /^[^.;]{0,30}\bto be acquired by\b/i.test(flat.slice(m.index + form.length, end))) return true;
    }
  }
  return false;
}

/** "On March 21, 2022" / "effective as of March 21, 2022" / "on 21 March 2022" in a sentence, as an ISO date. */
export function statedDate(sentence: string): string | null {
  const m =
    /\b(?:on|effective(?: as of)?|as of)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i.exec(sentence) ??
    /\b(?:on|effective(?: as of)?|as of)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})/i.exec(sentence);
  if (!m) return null;
  const [month, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
  const mi = MONTH.indexOf(month.toLowerCase());
  const d = Number(day);
  if (mi < 0 || d < 1 || d > 31) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
