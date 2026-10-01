/** Company-name display rules shared by the ingest (when storing) and the site (when serving older records). */

const KEEP_CAPS = /^(?:LLC|LP|LLP|PLC|NV|SA|AG|SE|USA|US|UK|II|III|IV|AI|IT|HR|RF|TV|CW|[A-Z]{1,3}|[A-Z]+\d+\w*)$/;
const SUFFIX_CASE: Record<string, string> = { INC: "Inc", "INC.": "Inc.", CORP: "Corp", "CORP.": "Corp.", LTD: "Ltd", "LTD.": "Ltd.", CO: "Co", "CO.": "Co.", HOLDINGS: "Holdings", GROUP: "Group" };
// Short English words that are words, not acronyms, in an all-capitals name.
const MINOR = new Set(["OF", "AND", "FOR", "AT", "IN", "ON", "BY", "TO", "THE", "A", "AN"]);
const SHORT_WORDS = new Set(["AIR", "OIL", "GAS", "SEA", "SUN", "BAY", "CAR", "NEW", "ONE", "TWO", "BIG", "RED", "TOP", "WAY", "FOX", "KEY", "ART", "LAW", "PRO", "BIO", "ITS", "OLD", "ICE", "SKY", "BAR", "WAR", "LAB", "EYE", "DOG", "CAT", "BOX", "HUB"]);

const capWord = (w: string) => w.replace(/[A-Z][A-Z'’&-]*/g, (t) => t[0] + t.slice(1).toLowerCase());

/**
 * "TETON FINANCIAL SERVICES" -> "Teton Financial Services"; "WTG MIDSTREAM" -> "WTG Midstream". Only names written
 * entirely in capitals with two or more words; short tokens (acronyms, "LLC") stay as they are. "IBM" and
 * "KKR" are untouched.
 */
export function titleCaseCaps(name: string): string {
  if (/[a-z]/.test(name) || name.trim().split(/\s+/).length < 2) return name;
  let first = true;
  return name
    .split(/(\s+)/)
    .map((w) => {
      if (/^\s+$/.test(w)) return w;
      const isFirst = first;
      first = false;
      if (MINOR.has(w)) return isFirst ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase();
      if (SHORT_WORDS.has(w)) return w[0] + w.slice(1).toLowerCase();
      if (SUFFIX_CASE[w]) return SUFFIX_CASE[w];
      if (KEEP_CAPS.test(w.replace(/[,.]$/, "")) || /&|\d|\.[A-Z]/.test(w)) return w;
      return capWord(w);
    })
    .join("");
}

/**
 * A company name as the terminal shows it: SEC state tags dropped ("Lifecore Biomedical, Inc. \Del\",
 * "Acme Corp /DE/"), all-capitals names title-cased, and a capitalised run inside a mixed name too
 * ("PERDOCEO EDUCATION Corp" -> "Perdoceo Education Corp", "TransDigm Group INC" -> "TransDigm Group Inc").
 * A single capitalised brand ("NVIDIA Corp", "BIO-TECHNE Corp") is left alone.
 */
export function displayCompanyName(raw: string): string {
  let s = raw.replace(/\s*[\\/][A-Za-z]{2,4}[\\/]?\s*$/, "").replace(/\s*[\\/]\s*$/, "").trim();
  if (!/[a-z]/.test(s)) return titleCaseCaps(s);
  s = s.replace(/\b(INC|CORP|LTD|CO)\b(\.?)/g, (_, w: string, dot: string) => (SUFFIX_CASE[w] ?? w) + dot);
  const caps = s.match(/\b[A-Z]{4,}\b/g) ?? [];
  if (caps.length >= 2) s = s.replace(/\b[A-Z]{4,}\b/g, (w) => (SUFFIX_CASE[w] ?? capWord(w)));
  // A capitalised possessive brand: "CAMPBELL'S Co" -> "Campbell's Co", "DENNY'S Corp" -> "Denny's Corp".
  s = s.replace(/\b([A-Z])([A-Z]{2,})(['’])S\b/g, (_, a: string, b: string, q: string) => a + b.toLowerCase() + q + "s");
  // SEC names lose acronyms when title-cased ("TXNM ENERGY" -> "Txnm Energy"): a word with no vowels is an acronym.
  s = s.replace(/\b[B-DF-HJ-NP-TV-XZ][b-df-hj-np-tv-xz]{1,4}\b/g, (w) => (/^(?:St|Mr|Mrs|Dr|Ft|Mt|Jr|Sr|Ltd|Svcs|Hldgs|Mgmt|Grp|Intl|Natl|Mfg|Pty|Bhd)$/.test(w) ? w : w.toUpperCase()));
  // Small words inside a name: "Bank Of Hawaii" -> "Bank of Hawaii".
  s = s.replace(/(?<=\S\s)(Of|And|For|The|At|In|On)(?=\s)/g, (w) => w.toLowerCase());
  return s;
}
