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
  // A release's noun form ("today announced the completion of its previously announced acquisition of GAP Promotions"); a bank's merger.
  ...["announced the completion of its", "announced the completion of the", "announced the closing of its"].flatMap((v) => PREVIOUSLY.map((p) => `${v} ${p}acquisition of ${name}`)),
  ...["completed the merger of", "completed its merger with", "completed the previously announced merger of"].map((v) => `${v} ${name}`),
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
  // (Or a brand with a capital inside it, as distinctive: "StonePoint Materials" → "StonePoint".)
  return words.length >= 2 && /^(?:[A-Z][a-z]{4,}|[A-Z][a-z]+[A-Z][a-z]+)$/.test(words[0]) && words[0].length >= 5 ? words[0] : null;
}

/** The core of a private company's name for searching: no legal suffix ("Avitide Inc." → "Avitide"). */
export function searchName(name: string): string | null {
  const core = name.replace(/,?\s+(?:Inc|LLC|L\.L\.C|Ltd|Limited|Corp|Corporation|Co|Company LLC|L\.?P|plc|S\.A|N\.V|B\.V|GmbH|AG|Oy|AB|SAS)\.?$/i, "").trim();
  // Too short or generic to search for on its own ("Joh", "Home Health", "Privately Held"); an acronym in capitals is a
  // name ("NFP": Aon's 10-Q says "completed the acquisition of NFP").
  // (A brand may start in lower case: mGage, aiXscale, iSun. A capital somewhere, or a digit first: 1st Colonial.)
  if ((core.length < 4 && !/^(?=[A-Z0-9]*[A-Z])[A-Z][A-Z0-9]{2}$/.test(core)) || !/[A-Z]/.test(core) || /^(?:the|an?|our|its)\s/.test(core) || /^(?:privately held|home health|consumer experience|the company)$/i.test(core)) return null;
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
// (Also a headline: "Arcosa, Inc. Announces Completion of StonePoint Materials Acquisition".)
const ANNOUNCED_DONE = /\bannounce[sd]? (?:the )?(?:successful )?(?:completion|closing)\b[^.;]{0,100}$/i;
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
// (Not a covenant's words: "until the closing or earlier termination of the Share Exchange Agreement", which made Blackboxstocks / Evtec read Terminated from a live deal's 10-K.)
const ENDED_DEAL = /(?<!\b(?:earlier|or|prior(?:\s+to)?|any|upon|such)\s+(?:the\s+)?)\bterminat(?:ed|ion of)\b[^.;]{0,120}\b(?:purchase|merger|exchange|acquisition|combination)\s+agreement\b/i;
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
  // Written as one word after the headline spaced it: "PH Precision Med" is "PHPrecisionMed Inc." (only with an initialism in it).
  const words = name.split(/\s+/);
  if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z][A-Za-z]*$/.test(w)) && words.some((w) => /^[A-Z]{2,3}$/.test(w))) add(words.join(""));
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
/**
 * The names a report uses for the company: its own forms, the term it defines ("Ametros Financial Corporation ("Ametros")")
 * and a glossary's short form, which a bank's 10-K prints as a table row, term then name: "Ametros Ametros Financial
 * Corporation", "ALCO Asset Liability Committee". Webster's reports then only say "the Bank acquired Ametros".
 */
function namesIn(flat: string, name: string): { form: string; re: RegExp }[] {
  const forms = nameForms(name);
  const rows: string[] = [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const form of [...forms]) {
    const term = new RegExp(`(?<![\\w-])${esc(form)}[^()"“”]{0,40}\\(\\s*(?:the\\s+)?["“]\\s*([^"”]{2,30}?)\\s*["”]\\s*\\)`).exec(flat)?.[1];
    if (term && /^[A-Z]/.test(term) && !NOT_A_NAME_TERM.test(term) && !forms.includes(term)) forms.push(term);
    const words = form.split(" ");
    if (words.length < 2) continue;
    const initials = words.map((w) => w[0]).join("").toUpperCase();
    const row = new RegExp(`(?<![\\w-])(${esc(words[0])}|${esc(initials)}) ${esc(form)}\\b`).exec(flat)?.[1];
    if (row && row.length >= 3 && !NOT_A_NAME_TERM.test(row) && !forms.includes(row) && !rows.includes(row)) rows.push(row);
  }
  // A glossary's short form stands alone and in its own case: "Citizens" inside "First Citizens Bank of Georgia" is another
  // company, and the initials "AIR" are not the word "air".
  return [
    ...forms.map((form) => ({ form, re: nameRegex(form) })),
    ...rows.map((form) => ({ form, re: new RegExp(`(?<![\\w-]|[A-Z][\\w&.'’-]*\\s)${esc(form)}(?![\\w-]|\\s+[A-Z])`, "g") })),
  ];
}

export function readLooseCompletion(text: string, name: string): CompletionRead {
  const flat = text.replace(/\s+/g, " ");
  for (const { form, re } of namesIn(flat, name)) {
    for (const m of flat.matchAll(re)) {
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
  // By the company's own forms only: a short term reaches the risk factors and the agreement's summary ("… the right of one or
  // both of the parties to terminate the definitive merger agreement" about Great Plains; "Termination The Merger Agreement may be
  // terminated …" about NEH), which read as ended.
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

// An 8-K's own sections (`section`), and its sentences. A heading, not a cross-reference: "Item 2.01 Completion …", not "Item 2.01 of this Current Report".
const SENTENCE_END = /(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])/;
const INTRO_NOTE = /\b(?:Introductory Note|INTRODUCTORY NOTE|Explanatory Note|EXPLANATORY NOTE|Introduction|INTRODUCTION)\b/;
const ITEM_201 = /\bItem\s*2\.01\b[\s.:\-–—]*(?:Completion|Acquisition|Disposition)/i;
const ITEM_101 = /\bItem\s*1\.01\b[\s.:\-–—]*Entry/i;
function section(flat: string, head: RegExp): string {
  const at = flat.search(head);
  if (at < 0) return "";
  const rest = flat.slice(at + 8);
  const end = rest.search(/\b[Ii][Tt][Ee][Mm]\s*\d\.\d\d\b[\s.:\-–—]+[A-Z]/);
  return end < 0 ? rest : rest.slice(0, end);
}
const DONE_VERB = /\b(?:completed|consummated|closed)\b/i;
const CLOSING_WORD = /\b(?:completed|completion|consummated|consummation|closed)\b/i;
// An agreement's date, not the closing's: "the Agreement and Plan of Merger, dated as of July 14, 2026".
const AGREEMENT_DAY = /\b(?:dated|made|entered into)(?:\s+(?:as of|on))?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi;
const CLOSED_DEAL_WORD = /\b(?:mergers?|acquisitions?|arrangement|business combination|combination|purchase|transactions?)\b/i;

/**
 * The closing day a buyer's 8-K states, in a plain sentence of its Item 2.01, Introductory Note or Item 1.01 saying completed, consummated or closed: "On
 * June 1, 2021, Kaleyra Inc. … completed its acquisition" (mGage), "Effective on February 27, 2026 …, Mid Penn completed" (1st Colonial), "On March 26, 2026,
 * the Company completed the Arrangement" (Contango / Dolly Varden), "On July 1, 2026, the Merger was consummated" (Lixte / NOMAD), through Item 2.01's pointer
 * to Item 1.01 too ("On November 3, 2021, the Company completed the Stock Acquisition": BurgerFi / Anthony's). A sentence naming the target first, then any
 * about a deal. Only after the announcement and not after the filing; never the date of the agreement. Null: the 8-K's filing date stands.
 */
export function statedClosingDay(text: string, named: RegExp, announcedDate: string, fileDate: string): string | null {
  const flat = text.replace(/\s+/g, " ");
  const sentencesOf = (s: string) => s.split(SENTENCE_END);
  const item201 = section(flat, ITEM_201);
  const item101 = sentencesOf(section(flat, ITEM_101));
  const main = [...sentencesOf(item201), ...sentencesOf(section(flat, INTRO_NOTE))];
  // (An 8-K is due in four business days: a day long before it is something else. Of 735 cached 8-Ks with an Item 2.01, those were another deal's or an offering's.)
  const floor = new Date(Date.parse(fileDate) - 30 * 86_400_000).toISOString().slice(0, 10);
  const inRange = (day: string | null) => (day && day > announcedDate && day >= floor && day <= fileDate ? day : null);
  const read = (s: string) => {
    const at = s.search(DONE_VERB);
    if (at < 0 || CONDITIONAL.test(s.slice(0, at)) || /\b(?:entered into|amended|issued)\b/i.test(s.slice(0, at))) return null;
    return inRange(statedDate(s.replace(AGREEMENT_DAY, " ")));
  };
  // Only where no sentence says completed, consummated or closed: "on March 12, 2024 (the "Closing Date"), Merger Sub merged with and into
  // XTI" (Inpixon). The day nearest before those words ("filed with the SEC on September 15, 2023, … on October 5, 2023 …, FAST II merged
  // with and into Pubco"), not a name change ("our wholly owned subsidiary … was merged with and into the Company and the Company adopted the name").
  const readMerged = (s: string) => {
    const m = /\bmerged\s+with\s+and\s+into\b|\(\s*the\s+["“]\s*Closing Date\s*["”]\s*\)/i.exec(s);
    if (!m || CONDITIONAL.test(s.slice(0, m.index)) || /\b(?:amended|issued)\b/i.test(s.slice(0, m.index)) || /\b(?:adopted the name|change (?:in|of) (?:our|its|the Company['’]s) (?:corporate )?name)\b/i.test(s)) return null;
    const before = s.slice(0, m.index + m[0].length).replace(AGREEMENT_DAY, " ");
    const days = [...before.matchAll(/\b(?:on|effective(?: as of)?|as of)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi)];
    return inRange(days.length ? statedDate(days[days.length - 1][0]) : statedDate(s.replace(AGREEMENT_DAY, " ")));
  };
  // Item 1.01 goes on to credit facilities and notes: by another deal word only when Item 2.01 sends the reader there (BurgerFi's "Stock Acquisition").
  const pointsToItem101 = item201.length < 400 && /\bItem\s*1\.01\b/i.test(item201) && /\bincorporated\b/i.test(item201);
  for (const reader of [read, readMerged]) {
    for (const s of [...main, ...item101]) {
      const day = named.test(s) ? reader(s) : null;
      if (day) return day;
    }
    for (const s of pointsToItem101 ? [...main, ...item101] : main) {
      const day = CLOSED_DEAL_WORD.test(s) ? reader(s) : null;
      if (day) return day;
    }
  }
  return null;
}

/**
 * A target that stays listed after selling out files neither Form 25 nor Item 5.01, so only its 8-K says the deal closed. The day it closed, when the 8-K's
 * opening or Item 2.01 says it completed the agreement this deal signed: "On October 21, 2026, Senti Biosciences Holdings, Inc. … completed the transactions
 * contemplated by the Agreement and Plan of Merger, dated as of July 14, 2026"; "the completion on January 23, 2026 … of the previously announced sale …
 * pursuant to the terms of the Asset Purchase Agreement, dated July 17, 2025" (Sonim). An agreement dated in the ten days up to the announcement, so not
 * the company's own purchase in between (Sonim's DNA X, December 2025), nor a later buyer's. `closingToRead` chooses which 8-Ks to read.
 */
export function completedSigningOn(text: string, announcedDate: string, fileDate: string): string | null {
  const flat = text.replace(/\s+/g, " ");
  const floor = new Date(Date.parse(announcedDate) - 10 * 86_400_000).toISOString().slice(0, 10);
  const signed = /\b(?:Plan of Merger|Merger Agreement|Purchase Agreement|Transaction Agreement|Arrangement Agreement|Combination Agreement|Exchange Agreement)\b[^.]{0,60}?\bdated(?:\s+as of)?\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i;
  for (const s of [INTRO_NOTE, ITEM_201].flatMap((head) => section(flat, head).split(SENTENCE_END))) {
    const at = s.search(CLOSING_WORD);
    if (at < 0 || CONDITIONAL.test(s.slice(0, at))) continue;
    const agreed = signed.exec(s);
    const on = agreed ? statedDate(`on ${agreed[1]}`) : null;
    if (!on || on < floor || on > announcedDate) continue;
    const day = statedDate(s.replace(AGREEMENT_DAY, " "));
    if (day && day > announcedDate && day <= fileDate) return day;
  }
  return null;
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
