/** Turn EDGAR HTML into clean plain text for pattern matching. */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
  hellip: "...",
  bull: "•",
  middot: "•",
  reg: "®",
  trade: "™",
  copy: "©",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  eth: "ð",
  thorn: "þ",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  deg: "°",
  times: "×",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  laquo: "«",
  raquo: "»",
  shy: "",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "",
  zwj: "",
};

// Accented letters by name: "&auml;" -> "ä", "&Ccedil;" -> "Ç" (BillerudKorsnäs, Boa Vista Serviços).
const MARKS: Record<string, string> = { acute: "́", grave: "̀", circ: "̂", uml: "̈", tilde: "̃", cedil: "̧", ring: "̊", caron: "̌" };

function namedEntity(name: string): string | undefined {
  if (ENTITIES[name] != null) return ENTITIES[name];
  const accent = /^([A-Za-z])(acute|grave|circ|uml|tilde|cedil|ring|caron)$/.exec(name);
  if (accent) return (accent[1] + MARKS[accent[2]]).normalize("NFC");
  return ENTITIES[name.toLowerCase()];
}

/**
 * Code points 128–159 read as Windows-1252, as older EDGAR filings mean them: "&#147;Company&#148;" is “Company”, not
 * two invisible control characters (which hid every defined term, "the Company", "Parent", from the 8-K parser).
 */
const WIN1252: Record<number, string> = {
  128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡", 136: "ˆ", 137: "‰", 138: "Š", 139: "‹", 140: "Œ", 142: "Ž",
  145: "‘", 146: "’", 147: "“", 148: "”", 149: "•", 150: "–", 151: "—", 152: "˜", 153: "™", 154: "š", 155: "›", 156: "œ", 158: "ž", 159: "Ÿ",
};
const codePoint = (n: number) => (n >= 128 && n <= 159 ? (WIN1252[n] ?? " ") : String.fromCodePoint(n));

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => namedEntity(n) ?? m)
    .replace(/[\u0080-\u009f]/g, (c) => codePoint(c.charCodeAt(0)));
}

export function htmlToText(html: string): string {
  // Plain-text documents keep their own line structure.
  const isHtml = /<(?:html|body|p|div|table|font|span)\b/i.test(html.slice(0, 5000));
  if (!isHtml) return decodeEntities(html).replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const text = html
    // Newlines in HTML source are just whitespace; only tags create line breaks.
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[  -​  ]/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Collapse all whitespace (for sentence-level regexes). */
export const flatten = (text: string) => text.replace(/\s+/g, " ").trim();
