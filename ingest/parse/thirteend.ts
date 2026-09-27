/**
 * Schedule 13D parsing. Since December 2024, 13Ds are structured XML (primary_doc.xml): the target
 * ("issuer"), each reporting person's stake, and Item 4, "Purpose of Transaction", where the
 * investor says what it wants. Pure (no requests).
 */

export interface DailyIndexRow {
  form: string;
  company: string;
  cik: string;
  date: string;
  adsh: string;
}

/** Rows of an EDGAR daily form index (form.YYYYMMDD.idx) for the given forms. */
export function parseDailyIndex(text: string, forms: RegExp): DailyIndexRow[] {
  const out: DailyIndexRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\S+(?: \S+)*?)\s{2,}(.+?)\s{2,}(\d+)\s+(\d{8})\s+edgar\/data\/\d+\/(\d{10}-\d{2}-\d{6})\.txt/.exec(line);
    if (!m || !forms.test(m[1])) continue;
    out.push({ form: m[1], company: m[2].trim(), cik: m[3], date: `${m[4].slice(0, 4)}-${m[4].slice(4, 6)}-${m[4].slice(6)}`, adsh: m[5] });
  }
  return out;
}

export interface Parsed13D {
  issuerCik: string;
  issuerName: string;
  eventDate: string | null;
  filerCik: string | null;
  persons: { name: string; cik: string | null; percent: number | null; shares: number | null }[];
  purpose: string;
}

const tag = (xml: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim() ?? null;
const decode = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

export function parse13DXml(xml: string): Parsed13D | null {
  const issuerCik = tag(xml, "issuerCIK");
  const issuerName = tag(xml, "issuerName");
  if (!issuerCik || !issuerName) return null;
  const persons = [...xml.matchAll(/<reportingPersonInfo>([\s\S]*?)<\/reportingPersonInfo>/g)].map((m) => {
    const p = m[1];
    const pct = tag(p, "percentOfClass");
    const sh = tag(p, "aggregateAmountOwned");
    return {
      name: decode(tag(p, "reportingPersonName") ?? ""),
      cik: tag(p, "reportingPersonCIK")?.replace(/^0+/, "") ?? null,
      percent: pct != null && !Number.isNaN(Number(pct)) ? Number(pct) : null,
      shares: sh != null && !Number.isNaN(Number(sh)) ? Number(sh) : null,
    };
  });
  const date = tag(xml, "dateOfEvent");
  const md = date && /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  return {
    issuerCik: issuerCik.replace(/^0+/, ""),
    issuerName: decode(issuerName),
    eventDate: md ? `${md[3]}-${md[1]}-${md[2]}` : null,
    filerCik: tag(tag(xml, "filerCredentials") ?? "", "cik")?.replace(/^0+/, "") ?? null,
    persons: persons.filter((p) => p.name),
    purpose: decode(tag(xml, "transactionPurpose") ?? ""),
  };
}

/** What the investor says it wants, from Item 4. */
export const AIMS: { aim: string; re: RegExp }[] = [
  { aim: "Board seats", re: /\b(?:nominat\w+|board (?:seat|representation|designee|nominee)s?|appoint\w* (?:to|of) the board|director (?:nominee|candidate)s?|proxy contest|solicit\w* proxies|cooperation agreement)\b/i },
  { aim: "Sale or strategic review", re: /\b(?:sale of the (?:issuer|company)|strategic alternatives|strategic review|explore (?:a )?(?:sale|strategic)|potential (?:sale|acquisition|business combination|going[- ]private)|take[- ]private|merger|business combination|acquire (?:all|the remaining))\b/i },
  { aim: "Capital return", re: /\b(?:share (?:re)?purchases?|buybacks?|repurchase program|special dividend|return(?:ing)? (?:of )?capital|capital allocation)\b/i },
  { aim: "Management or governance", re: /\b(?:management changes?|replace (?:the )?(?:ceo|chief executive|management)|governance|executive compensation|declassif\w+|separate the (?:roles|chair))\b/i },
  { aim: "Break-up or spin-off", re: /\b(?:spin[- ]?off|separation of|divest\w*|break[- ]?up|split (?:the company|into))\b/i },
  { aim: "Operational changes", re: /\b(?:operational improvements?|cost (?:reductions?|cutting)|margin improvement|business strategy|operating performance|undervalued)\b/i },
];

/**
 * Every 13D repeats the SEC's Item 4 checklist ("the Reporting Persons may, from time to time,
 * engage with management regarding (a) an extraordinary transaction … (d) any change in the board …").
 * Those hedged sentences say nothing about an actual campaign, so they are dropped before tagging.
 */
const BOILERPLATE =
  /\([a-j]\)|subparagraphs?|clauses? \(a\)|Item 4 of (?:the )?Schedule 13D|\bmay\b[^.]{0,80}\b(?:engage|consider|formulate|seek|propose|take|discuss|communicate)|reserves? the right|no (?:present )?plans or proposals|depending (?:on|upon)|from time to time|incorporated (?:herein )?by reference/i;

export function campaignText(purpose: string): string {
  return purpose
    .split(/(?<=[.;])\s+(?=[A-Z(])/)
    .filter((s) => !BOILERPLATE.test(s))
    .join(" ");
}

/** Concrete campaign actions (not hedged possibilities). */
const CAMPAIGN =
  /\b(?:nominat\w+|proxy contest|solicit\w* (?:of )?proxies|cooperation agreement|settlement agreement|nomination agreement|(?:sent|delivered|issued|wrote|published) (?:a |an open |a public )?letter|letter (?:to|addressed to) the (?:board|issuer|company|chair)|urg(?:e|ed|es|ing) the (?:board|issuer|company)|call(?:ed|s|ing)? (?:on|upon) the (?:board|issuer|company)|special meeting of (?:stockholders|shareholders)|withhold|board (?:seats?|representation)|appointed to the board|demand\w*)\b/i;

/** Shares that came from the company or a deal, or holders who run or control it: not activism. */
const NOT_ACTIVISM =
  /\b(?:securities purchase agreement|subscription agreement|share purchase agreement|stock purchase agreement|investment agreement|private placement|consideration shares|as (?:merger|business combination) consideration|restructuring|business combination|merger sub|pursuant to the merger agreement|completed the (?:previously announced )?merger|closing date|exit notes|pre-funded warrant|operating partner|chief executive officer of the issuer|serves as (?:the )?(?:chairman|chief executive|president|director|ceo)|founder|co-founder|initial public offering|voting control|estate planning|gift)\b/i;

/** Well-known activist investors (the filer's name is checked against this). */
export const KNOWN_ACTIVISTS =
  /\b(Elliott (?:Investment )?Management|Elliott Associates|Starboard|Trian|ValueAct|JANA Partners|Engaged Capital|Icahn|Third Point|Pershing Square|Ancora|Land & Buildings|Legion Partners|Irenic|Mantle Ridge|Sachem Head|Corvex|D\. ?E\. Shaw|Politan|Cevian|Blackwells|Impactive|Inclusive Capital|Barington|Driver Management|Engine Capital|Voss Capital|Kent Lake|Palogic|Saba Capital|Bulldog Investors|Ortelius|Browning West|Jericho Capital|Lion Point|Oasis Management|Macellum|Glenview|Marcato|Hudson Executive|Scopia|Coliseum|Stilwell|Kanen|Engine No\. 1|Parvus|Cat Rock|Toms Capital|Eminence|Anson Funds|Carrian|Harbert Discovery|Firefly Value|Gilead Capital|Nelson Peltz|Carl C\. Icahn|Dan Loeb|Bill Ackman|Jeffrey Smith|Cannell|Legion|Rubric Capital|Sarissa|Caligan|Fir Tree|Silver Point|Boaz Weinstein)\b/i;

/** Demands actually stated (boilerplate removed). */
export function aimsOf(purpose: string): string[] {
  const text = campaignText(purpose);
  return AIMS.filter(({ re }) => re.test(text)).map(({ aim }) => aim);
}

/**
 * Activist = a known activist fund, or an outside investor (≤ 50%, not a SPAC sponsor or insider,
 * shares not bought from the company) whose Item 4 describes a concrete campaign.
 */
export function isActivist(investorName: string, purpose: string, ctx: { percent: number | null; issuerName: string }): boolean {
  if (ctx.percent != null && ctx.percent > 50) return false;
  if (/\bAcquisition Corp|\bSponsor\b/i.test(`${ctx.issuerName} ${investorName}`)) return false;
  if (KNOWN_ACTIVISTS.test(investorName)) return true;
  const text = campaignText(purpose);
  return CAMPAIGN.test(text) && !NOT_ACTIVISM.test(purpose);
}

/** A short, readable excerpt of Item 4 (first sentences, boilerplate trimmed). */
export function purposeExcerpt(purpose: string, max = 480): string {
  const s = purpose.replace(/^(?:Item 4\.?\s*)?(?:Purpose of (?:the )?Transaction\.?\s*)?/i, "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")) + " …";
}
