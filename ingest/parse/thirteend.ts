/**
 * Schedule 13D parsing. Since December 2024, 13Ds are structured XML (primary_doc.xml): the target
 * ("issuer"), each reporting person's stake, and Item 4, "Purpose of Transaction", where the
 * investor says what it wants. Pure (no requests).
 */
import { decodeEntities } from "../text";

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
  /** `individual`: the cover page's type of reporting person is "IN" (a person, not a fund or company). */
  persons: { name: string; cik: string | null; percent: number | null; shares: number | null; individual: boolean }[];
  purpose: string;
  /** Item 3, where the money and the shares came from. */
  source: string;
  /** Item 5's stated total for the whole group, when it gives one. */
  groupTotal: { shares: number; percent: number } | null;
  /** Signature block: who signs for which reporting person ("/s/ Carl C. Icahn"). */
  signatures: { person: string; signature: string }[];
}

const tag = (xml: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim() ?? null;
// Numeric entities too: "&#13;" reached the page and hid sentence ends (BML's letter to AN2 ran on into its hedging).
const decode = (s: string) =>
  decodeEntities(
    s
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'"),
  )
    .replace(/\s+/g, " ")
    .trim();

/** Words that mark an entity, not a person, in an EDGAR filer name. */
const ENTITY_WORDS =
  /\b(?:LLC|L\.?L\.?C|LP|L\.?P|LLP|Inc|Corp|Co|Company|Ltd|Limited|plc|N\.?V|S\.?A|AG|GmbH|Trust|Fund|Funds|Capital|Management|Partners|Partnership|Group|Holdings?|Advisors?|Advisers?|Associates|Investments?|Investors?|Ventures?|Opportunit\w*|Master|Foundation|Bank|Securities|Financial|Equity|Asset|Assets|Global|International|Enterprises?|Family|Office|Value|Strategies|Offshore|Onshore|Series|SPV|Estate|Revocable|Irrevocable|Living)\b/i;

/**
 * EDGAR lists a person as "ICAHN CARL C" (last name first). Returns "Carl C. Icahn" for such a name, or null when
 * the name is an entity ("Starboard Value LP") or doesn't look like a person's.
 */
export function personFromConformed(name: string): string | null {
  const s = name.replace(/\s+/g, " ").trim();
  if (!s || ENTITY_WORDS.test(s) || /[\d&,/]/.test(s)) return null;
  const words = s.split(" ");
  if (words.length < 2 || words.length > 4 || !words.every((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w))) return null;
  const suffix = /^(?:JR|SR|II|III|IV)\.?$/i.test(words.at(-1)!) ? words.pop()! : null;
  if (words.length < 2) return null;
  const [last, ...given] = words;
  const cap = (w: string) => (/^[A-Z]\.?$/i.test(w) ? `${w[0].toUpperCase()}.` : w[0].toUpperCase() + w.slice(1).toLowerCase().replace(/(['-])([a-z])/g, (_, p, c) => p + c.toUpperCase()));
  const capLast = cap(last).replace(/^(Mc|Mac)([a-z])/, (_, p, c) => p + c.toUpperCase());
  return [...given.map(cap), capLast, ...(suffix ? [suffix.toUpperCase().replace(/^(JR|SR)\.?$/, (m) => m[0] + m[1].toLowerCase() + ".")] : [])].join(" ");
}

/**
 * "the Reporting Persons beneficially own an aggregate of 2,188,109 shares of Class A Common Stock, representing
 * approximately 5.4%" (Karp and Berman on Grove: each holds apart from the other, so the largest cover page, 4.1%, is low).
 */
const GROUP_TOTAL = /\bReporting Persons (?:collectively )?(?:beneficially )?own(?:ed)? an aggregate of ([\d,]+) shares\b[^.]{0,80}?approximately ([\d.]+)%/i;

function groupTotalOf(item5: string): Parsed13D["groupTotal"] {
  const m = GROUP_TOTAL.exec(item5);
  if (!m) return null;
  const shares = Number(m[1].replace(/,/g, ""));
  const percent = Number(m[2]);
  return shares > 0 && percent > 0 && percent <= 100 ? { shares, percent } : null;
}

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
      individual: /\bIN\b/.test(tag(p, "typeOfReportingPerson") ?? ""),
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
    source: decode(tag(xml, "item3") ?? ""),
    groupTotal: groupTotalOf(decode(tag(xml, "item5") ?? "")),
    signatures: [...xml.matchAll(/<signaturePerson>([\s\S]*?)<\/signaturePerson>/g)].map((m) => ({
      person: decode(tag(m[1], "signatureReportingPerson") ?? ""),
      signature: decode(tag(m[1], "signature") ?? "").replace(/^\/s\/\s*/i, ""),
    })),
  };
}

/**
 * The stake to show. Reporting persons usually overlap (a fund and its manager report the same shares), so the largest
 * one stands for the group, unless Item 5 states a total at least that large. A 13D means more than 5%: a percentage
 * under 1 is a misread, or one member's direct holding.
 */
export function stakeFigures(p: Pick<Parsed13D, "persons" | "groupTotal">): { percent: number | null; shares: number | null } {
  const percents = p.persons.map((x) => x.percent).filter((v): v is number => v != null && v <= 100);
  const shareCounts = p.persons.map((x) => x.shares).filter((v): v is number => v != null);
  const percent = percents.length && Math.max(...percents) >= 1 ? Math.max(...percents) : null;
  const shares = shareCounts.length ? Math.max(...shareCounts) : null;
  const total = p.groupTotal;
  return total && total.percent >= (percent ?? 0) && total.shares >= (shares ?? 0) ? total : { percent, shares };
}

/**
 * How to show an individual investor's name. EDGAR's own (all-capitals) names put the surname first ("ICAHN CARL
 * C"); names filers typed come in either order ("Braeden Lichti", "Stilwell Joseph"). People sign in their natural
 * order, so the signature decides when the person signed for themselves; otherwise only an all-capitals EDGAR name is
 * turned around. Null: not an individual, or no safe way to tell (keep the name as filed).
 */
export function individualName(p: Pick<Parsed13D, "persons" | "signatures">, investorCik: string | null, conformed: string | null | undefined): string | null {
  const person = p.persons.find((x) => x.cik === investorCik);
  if (!person?.individual) return null;
  const key = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1).sort().join(" ");
  const own = key(person.name);
  const signed = p.signatures.find((s) => key(s.person) === own && key(s.signature) === own)?.signature;
  if (signed) return signed === signed.toUpperCase() || signed === signed.toLowerCase() ? signed.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, b, c) => b + c.toUpperCase()) : signed;
  const allCaps = [conformed, person.name].find((n): n is string => !!n && n === n.toUpperCase());
  return allCaps ? personFromConformed(allCaps) : null;
}

/** What the investor says it wants, from Item 4. */
export const AIMS: { aim: string; re: RegExp }[] = [
  // "(i) remove the current members of the Issuer's board of directors ... (ii) elect S.H.N.'s nominees": PRF.
  { aim: "Board seats", re: /\b(?:nominat\w+|nominees?|board (?:seat|representation|designee|nominee)s?|appoint\w* (?:to|of) the board|director (?:nominee|candidate)s?|proxy contest|solicit\w* proxies|cooperation agreement|remov\w+ [^.]{0,60}directors?|elect(?:s|ed|ing|ion)? [^.]{0,60}directors?)\b/i },
  // Not a bare "merger": any "Merger Agreement" had tagged a sale. "a merger with Star Equity" (GEE) is the demand.
  { aim: "Sale or strategic review", re: /\b(?:sale of the (?:issuer|company)|strategic alternatives|strategic review|explor\w+ (?:a )?(?:sale|strategic)|potential (?:sale|acquisition|business combination|going[- ]private)|take[- ]private|(?:a|the proposed) merger with|sale process|liquidation of the (?:issuer|company)|acquire (?:all|the remaining))\b/i },
  { aim: "Capital return", re: /\b(?:share (?:re)?purchases?|buybacks?|repurchase program|special dividend|return(?:ing)? (?:of )?capital|capital returns?|capital allocation)\b/i },
  { aim: "Management or governance", re: /\b(?:management changes?|replace (?:the )?(?:ceo|chief executive|management)|governance|executive compensation|declassif\w+|separate the (?:roles|chair))\b/i },
  // "its announced divestiture" is the company's own news (Palogic on Health Catalyst), no demand.
  { aim: "Break-up or spin-off", re: /\b(?:spin[- ]?(?:off|out)|separation of|(?<!announced )divest\w*|break[- ]?up|split (?:the company|into))\b/i },
  // Not "undervalued": it is why nearly every 13D bought (Saba, JANA, Voss), and it tagged 35 of 101 stakes with a demand.
  { aim: "Operational changes", re: /\b(?:operational improvements?|cost (?:reductions?|cutting)|margin improvement|business strategy|operating performance)\b/i },
];

/**
 * Every 13D repeats the SEC's Item 4 checklist ("the Reporting Persons may, from time to time,
 * engage with management regarding (a) an extraordinary transaction … (d) any change in the board …").
 * Those hedged sentences say nothing about an actual campaign, so they are dropped before tagging.
 * Not "(i)": that opens a real list ("(i) remove the current members of the Issuer's board": S.H.N. on PRF).
 * A reference only as the whole sentence's point: Sit's letter to MFS is described in a sentence ending "incorporated by reference".
 */
const BOILERPLATE =
  /\([a-hj]\)|subparagraphs?|clauses? \(a\)|Item 4 of (?:the )?Schedule 13D|reserves? the right|no (?:present )?plans or proposals|depending (?:on|upon)|from time to time|^(?:the )?(?:information|disclosure|response|foregoing description|a copy of)\b[^.]{0,120}(?:incorporated|qualified|attached)/i;

/**
 * Whatever a sentence says it "may" do is no demand: Saba's "may nominate one or more individuals" sits in every one of
 * its 13Ds. Case-sensitive, because the month May isn't a hedge.
 */
const HEDGED = /\bmay\b/;

/** A sentence end, not a title, a legal suffix or an initial ("Dr. Ellen S. Baron", "Mr. Ofer", "Inc. and"). */
const SENTENCE_END = /(?<=\.)(?<!\b(?:Mr|Mrs|Ms|Dr|Messrs|Prof|Inc|Corp|Ltd|Co|LLC|St|No|Jr|Sr|[A-Z])\.)\s+(?=[A-Z(])/;

/** Words that look like a campaign and aren't: KMJ's "demand rights", Ibotta's "nomination under 240.14a-11", a board committee, a job title. */
const NOT_A_CAMPAIGN_WORD =
  /\b(?:Nominating (?:and|&) (?:Corporate )?Governance Committee|Nominating Committee|nomination under (?:Rule )?240\.14a-11|(?:piggyback and )?demand (?:registration )?rights?|demand registration|Chief Demand Officer|tax withholding|demand(?:s|ing)? (?:the )?appraisal)\b/gi;

/**
 * What a sentence states before it turns to what it "may" do: Radoff on Alto Ingredients "intend to vote their Shares against the reelection of all
 * directors … and may nominate a competing slate" is a campaign. Saba's "may make … proposals, or may nominate" states nothing.
 */
function unhedged(sentence: string): string {
  const at = sentence.search(/,?\s+(?:and|or|but)\s+may\b/);
  const head = at >= 0 ? sentence.slice(0, at) + "." : sentence;
  return HEDGED.test(head) ? "" : head;
}

/** The sentences that state something, word for word: the page quotes these. */
function statedSentences(purpose: string): string {
  return purpose
    .split(SENTENCE_END)
    .filter((s) => !BOILERPLATE.test(s))
    .map(unhedged)
    .filter(Boolean)
    .join(" ");
}

export function campaignText(purpose: string): string {
  return statedSentences(purpose).replace(NOT_A_CAMPAIGN_WORD, " ");
}

/** Concrete campaign actions (not hedged possibilities). */
const CAMPAIGN =
  /\b(?:vot\w+ [^.]{0,60}\bagainst\b|nominat\w+|proxy contest|solicit\w* (?:of )?proxies|cooperation agreement|settlement agreement|nomination agreement|(?:sent|delivered|issued|wrote|published) (?:a |an open |a public |a demand )?letter|letter (?:to|addressed to) the (?:board|issuer|company|chair)|urg(?:e|ed|es|ing) the (?:board|issuer|company)|call(?:ed|s|ing)? (?:on|upon) the (?:board|issuer|company)|special meeting of (?:stockholders|shareholders)|withhold|board (?:seats?|representation)|recommend\w* [^.]{0,40}to the board|(?:communicated|presented|raised) [^.]{0,40}concerns|expressed (?:his|her|its|their) view|demand\w*)\b/i;

/**
 * A demand in the investor's own voice: it outweighs how the shares were bought (Karp's subscription agreement, then
 * his open letter urging a sale of Grove; Moalem "is dissatisfied with the Issuer's performance", holding from before Nano-X's IPO).
 */
const OWN_DEMAND =
  /\b(?:(?:sent|delivered|issued|wrote|published) (?:a |an open |a public |a demand )?(?:letter|press release|notice)|called for|urg(?:e|ed|es|ing) (?:the )?(?:board|issuer|company|stockholders|shareholders|management)|demanding|dissatisf\w+|Nomination Notice|delivered to the Issuer a notice)\b/i;

/** Says outright it isn't a campaign, whatever else it says: KDT on Ibotta ("view themselves as passive investors"), Recanati on Evogene (a director voting the board's slate). */
const NOT_ITS_CAMPAIGN = /\b(?:serves as a member of the board|passive investors?)\b/i;

/** Shares that came from the company or a deal, or holders who run or control it: not activism. */
const NOT_ACTIVISM =
  /\b(?:securities purchase agreement|subscription agreement|share purchase agreement|stock purchase agreement|investment agreement|private placement|consideration shares|as (?:merger|business combination) consideration|restructuring|business combination|merger sub|pursuant to the merger agreement|completed the (?:previously announced )?merger|closing date|exit notes|pre-funded warrant|operating partner|chief executive officer of the issuer|serves as (?:the )?(?:chairman|chief executive|president|director|ceo)|founder|co-founder|initial public offering|voting control|estate planning|gift|passive investors?|serves as a member of the board|member of the board of directors of the issuer|participates in the management of the issuer|employment by the issuer|investor rights agreement|membership interest purchase agreement|purchase agreements?|director nomination agreement|lock-?up agreement|underwritten, registered offering|backstop agreement|in favor of the slate of director nominees nominated by the issuer)\b/i;

/** The stake itself came out of a deal or a note exchange, true of a known fund too (Elliott's shares in Uniti). */
const SHARES_FROM_A_DEAL = /\b(?:exchange offer|pre-closing reorganization)\b/i;

/** Item 3: bought from the company, not in the market (Suvretta's "Series D Preferred Stock Purchase Agreement with the Issuer" on Avalyn). */
const BOUGHT_FROM_THE_COMPANY =
  /\b(?:preferred stock purchase agreement|securities purchase agreement|subscription agreements?|initial public offering|private placement|closing date|the merger|the repurchase|term loan)\b/i;

/** Well-known activist investors (the filer's name is checked against this). */
export const KNOWN_ACTIVISTS =
  /\b(Elliott (?:Investment )?Management|Elliott Associates|Starboard|Trian|ValueAct|JANA Partners|Engaged Capital|Icahn|Third Point|Pershing Square|Ancora|Land & Buildings|Legion Partners|Irenic|Mantle Ridge|Sachem Head|Corvex|D\. ?E\. Shaw|Politan|Cevian|Blackwells|Impactive|Inclusive Capital|Barington|Driver Management|Engine Capital|Voss Capital|Kent Lake|Palogic|Saba Capital|Bulldog Investors|Ortelius|Browning West|Jericho Capital|Lion Point|Oasis Management|Macellum|Glenview|Marcato|Hudson Executive|Scopia|Coliseum|Stilwell|Kanen|Engine No\. 1|Parvus|Cat Rock|Toms Capital|Eminence|Anson Funds|Carrian|Harbert Discovery|Firefly Value|Gilead Capital|Nelson Peltz|Carl C\. Icahn|Dan Loeb|Bill Ackman|Jeffrey Smith|Cannell|Legion|Rubric Capital|Sarissa|Caligan|Fir Tree|Silver Point|Boaz Weinstein)\b/i;

/** Demands actually stated (boilerplate removed). */
export function aimsOf(purpose: string): string[] {
  const text = campaignText(purpose);
  return AIMS.filter(({ re }) => re.test(text)).map(({ aim }) => aim);
}

/**
 * Activist = a known activist fund (unless the stake came out of a deal or note exchange), or an outside investor
 * (≤ 50%, not a SPAC sponsor or insider, shares not bought from the company) whose Item 4 describes a concrete campaign.
 * `source` is Item 3. A demand in its own voice outweighs how the shares were bought, not a statement that it's passive.
 */
export function isActivist(investorName: string, purpose: string, ctx: { percent: number | null; issuerName: string; source?: string }): boolean {
  if (ctx.percent != null && ctx.percent > 50) return false;
  if (/\bAcquisition Corp|\bSponsor\b/i.test(`${ctx.issuerName} ${investorName}`)) return false;
  const text = campaignText(purpose);
  if (SHARES_FROM_A_DEAL.test(purpose) && !OWN_DEMAND.test(text)) return false;
  if (KNOWN_ACTIVISTS.test(investorName)) return true;
  if (!CAMPAIGN.test(text)) return false;
  if (OWN_DEMAND.test(text)) return !NOT_ITS_CAMPAIGN.test(purpose);
  return !NOT_ACTIVISM.test(purpose) && !BOUGHT_FROM_THE_COMPANY.test(ctx.source ?? "");
}

/** Why it bought and its 13G history: true, but not what it wants, and they used to fill the quote (CAS on Hilton Grand Vacations leads with its nomination talks now). */
const BACKGROUND = /\b(?:undervalued|attractive investment|for investment purposes|solely for investment|previously reported on Schedule 13G|in the ordinary course)\b/i;

/** A short, readable excerpt of Item 4: what the investor actually says, not the standard hedging, when enough is left. */
export function purposeExcerpt(purpose: string, max = 480): string {
  const said = statedSentences(purpose);
  const clean = (said.length >= 80 ? said : purpose).replace(/^(?:Item 4\.?\s*)?(?:Purpose of (?:the )?Transaction\.?\s*)?/i, "").trim();
  const lead = clean
    .split(SENTENCE_END)
    .filter((x) => !BACKGROUND.test(x))
    .join(" ");
  const s = lead.length >= 80 ? lead : clean;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")) + " …";
}
