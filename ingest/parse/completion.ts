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
  if ((core.length < 4 && !/^[A-Z]{3}$/.test(core)) || !/[A-Z]/.test(core[0]) || /^(?:privately held|home health|consumer experience|the company)$/i.test(core)) return null;
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

const CONDITIONAL = /\b(?:if|may|might|could|would|will|shall|expects?|expected|anticipates?|anticipated|intends?|plans?|right to|option to|upon|until|unless|whether|pending|proposed)\b/i;

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
      if (!CONDITIONAL.test(before)) return { found: true, date: statedDate(sentence), today: /\btoday\b/i.test(sentence) };
      at = lower.indexOf(p.toLowerCase(), at + 1);
    }
  }
  return { found: false, date: null, today: false };
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
