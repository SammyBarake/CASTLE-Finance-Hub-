/**
 * Activist stakes from Schedule 13D. Discovery uses EDGAR's daily form index (full-text search
 * barely indexes the XML 13Ds); each new 13D whose issuer is US-listed is fetched and parsed.
 * Only activists are kept (known funds, or a campaign stated in Item 4). Amendments (13D/A) are
 * counted from the index alone.
 */
import type { Directory } from "./deals";
import { adshNoDashes, filingIndexUrl, getDailyIndex, getSubmissions, getText, trimCik } from "./edgar";
import { aimsOf, campaignText, individualName, isActivist, parse13DXml, parseDailyIndex, personFromConformed, purposeExcerpt, type DailyIndexRow } from "./parse/thirteend";
import { displayName } from "./parse/press";
import type { State } from "./store";

/** Keep the page light: the newest stakes only, within ~18 months. */
const MAX_STAKES = 300;
const MAX_AGE_DAYS = 550;

function* businessDays(from: string, to: string) {
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) yield d.toISOString().slice(0, 10);
}

const dailyIndexUrl = (day: string) =>
  `https://www.sec.gov/Archives/edgar/daily-index/${day.slice(0, 4)}/QTR${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}/form.${day.replace(/-/g, "")}.idx`;

interface Group {
  adsh: string;
  form: string;
  date: string;
  names: Map<string, string>;
}

export async function ingestActivists(state: State, opts: { from: string; to: string; directory: Directory; log: (s: string) => void }) {
  const { directory, log } = opts;
  // XML 13Ds began on 2024-12-18; older ones are free text and not parsed here.
  const from = opts.from < "2024-12-18" ? "2024-12-18" : opts.from;
  const rows: DailyIndexRow[] = [];
  let days = 0;
  for (const day of businessDays(from, opts.to)) {
    // Holidays (and today, before the evening build) have no index file.
    const text = await getDailyIndex(dailyIndexUrl(day));
    if (!text) continue;
    rows.push(...parseDailyIndex(text, /^SCHEDULE 13D(\/A)?$/));
    days++;
    if (days % 50 === 0) log(`  read ${days} daily indexes (${day})`);
  }
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const g = groups.get(r.adsh) ?? { adsh: r.adsh, form: r.form, date: r.date, names: new Map() };
    g.names.set(r.cik, r.company);
    groups.set(r.adsh, g);
  }
  log(`  ${days} daily indexes: ${[...groups.values()].filter((g) => g.form === "SCHEDULE 13D").length} new 13Ds, ${[...groups.values()].filter((g) => g.form !== "SCHEDULE 13D").length} amendments`);

  let added = 0;
  const byId = new Map(state.activists.map((s) => [s.id, s]));
  for (const g of groups.values()) {
    if (g.form !== "SCHEDULE 13D" || state.seen.has(`13d:${g.adsh}`)) continue;
    // Only fetch when one of the parties is a listed company (the issuer).
    const listedCik = [...g.names.keys()].find((cik) => directory.byCik.has(cik));
    if (!listedCik) {
      state.seen.add(`13d:${g.adsh}`);
      continue;
    }
    try {
      const xml = await getText(`https://www.sec.gov/Archives/edgar/data/${trimCik(listedCik)}/${adshNoDashes(g.adsh)}/primary_doc.xml`);
      const p = parse13DXml(xml);
      state.seen.add(`13d:${g.adsh}`);
      const issuer = p && directory.byCik.get(p.issuerCik);
      if (!p || !issuer) continue;
      const investorCik = p.filerCik && p.filerCik !== p.issuerCik ? p.filerCik : ([...g.names.keys()].find((c) => c !== p.issuerCik) ?? null);
      const conformed = investorCik ? g.names.get(investorCik) : undefined;
      const investorName = conformed ?? p.persons.find((x) => x.cik && x.cik !== p.issuerCik)?.name ?? p.persons[0]?.name ?? "Unknown investor";
      // A person is listed by EDGAR as "ICAHN CARL C": show "Carl C. Icahn".
      const shownName = individualName(p, investorCik, conformed) ?? displayName(investorName);
      // A 13D means more than 5%: a figure under 1% is a misread (or one group member's direct holding).
      const percents = p.persons.map((x) => x.percent).filter((v): v is number => v != null && v <= 100);
      const percent = percents.length && Math.max(...percents) >= 1 ? Math.max(...percents) : null;
      if (!isActivist(investorName, p.purpose, { percent, issuerName: issuer.name })) continue;
      const aims = aimsOf(p.purpose);
      const shares = p.persons.map((x) => x.shares).filter((v): v is number => v != null);
      byId.set(g.adsh, {
        id: g.adsh,
        filedDate: g.date,
        eventDate: p.eventDate,
        investor: { name: shownName, cik: investorCik },
        company: { name: displayName(issuer.name), ticker: issuer.ticker, cik: p.issuerCik },
        percent,
        shares: shares.length ? Math.max(...shares) : null,
        aims,
        // Lead with what the investor actually says, not the standard hedging language.
        purpose: purposeExcerpt(campaignText(p.purpose).length >= 80 ? campaignText(p.purpose) : p.purpose),
        activist: true,
        amendments: 0,
        lastAmended: null,
        url: filingIndexUrl(p.issuerCik, g.adsh),
      });
      added++;
    } catch (err) {
      log(`  ! 13D ${g.adsh}: ${(err as Error).message}`);
    }
  }

  // Stakes stored before these rules: drop a sub-1% figure, and turn a person's name around ("Icahn Carl C" ->
  // "Carl C. Icahn") when the 13D marks the investor as an individual. Once per stake.
  for (const s of byId.values()) {
    if (s.percent != null && s.percent < 1) s.percent = null;
    // The company's current SEC name with today's display rules ("UMH PROPERTIES" -> "UMH Properties", not "Umh").
    const listed = s.company.cik ? directory.byCik.get(s.company.cik) : undefined;
    if (listed) s.company.name = displayName(listed.name);
    const key = `13dname:${s.id}`;
    if (state.seen.has(key) || !s.investor.cik || !s.company.cik) continue;
    state.seen.add(key);
    if (!personFromConformed(s.investor.name)) continue; // an entity's name
    try {
      const p = parse13DXml(await getText(`https://www.sec.gov/Archives/edgar/data/${trimCik(s.company.cik)}/${adshNoDashes(s.id)}/primary_doc.xml`));
      if (!p?.persons.find((x) => x.cik === s.investor.cik)?.individual) continue;
      s.investor.name = individualName(p, s.investor.cik, (await getSubmissions(s.investor.cik)).name) ?? s.investor.name;
    } catch (err) {
      state.seen.delete(key); // try again next run
      log(`  ! 13D name ${s.id}: ${(err as Error).message}`);
    }
  }

  // Amendments: count each 13D/A once against the stake with the same investor and issuer.
  const stakes = [...byId.values()];
  for (const g of groups.values()) {
    if (g.form === "SCHEDULE 13D" || state.seen.has(`13da:${g.adsh}`)) continue;
    const s = stakes.find((x) => x.company.cik && g.names.has(x.company.cik) && x.investor.cik && g.names.has(x.investor.cik) && g.date >= x.filedDate);
    if (!s) continue;
    s.amendments++;
    if (!s.lastAmended || g.date > s.lastAmended) s.lastAmended = g.date;
    state.seen.add(`13da:${g.adsh}`);
  }

  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  state.activists = stakes
    .filter((s) => s.filedDate >= cutoff)
    .sort((a, b) => b.filedDate.localeCompare(a.filedDate) || a.id.localeCompare(b.id))
    .slice(0, MAX_STAKES);
  return { added, total: state.activists.length };
}
