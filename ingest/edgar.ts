/**
 * Minimal SEC EDGAR client.
 *
 * SEC fair-access rules: a descriptive User-Agent with contact info on every
 * request, and no more than 10 requests per second. We stay well under that.
 * https://www.sec.gov/os/accessing-edgar-data
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIN_INTERVAL_MS = 125; // ~8 req/s
const MAX_RETRIES = 4;

let lastRequest = 0;
let requestCount = 0;

function userAgent(): string {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua || !/@/.test(ua)) {
    throw new Error('SEC_USER_AGENT is not set. Add e.g. SEC_USER_AGENT="Castle research you@example.com" to .env.local');
  }
  return ua;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
}

export class NotFoundError extends Error {}

async function request(url: string, opts: { missingIs403?: boolean } = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    requestCount++;
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": userAgent(), "Accept-Encoding": "gzip, deflate" } });
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res;
    if (res.status === 404 || (opts.missingIs403 && res.status === 403)) throw new NotFoundError(`${res.status} ${url}`);
    // 429/403 = rate limited; 5xx = transient. Back off and retry.
    if (attempt >= MAX_RETRIES || ![403, 429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`EDGAR ${res.status} for ${url}`);
    }
    await sleep(res.status === 429 || res.status === 403 ? 10_000 : 1000 * 2 ** attempt);
  }
}

/**
 * A daily index file, or null when there is none (weekends and holidays). The archive answers a
 * missing file with 403, which `request` would otherwise treat as rate limiting and retry.
 */
export async function getDailyIndex(url: string): Promise<string | null> {
  try {
    return await (await request(url, { missingIs403: true })).text();
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T;
}

// Optional on-disk cache for immutable archive documents (set EDGAR_CACHE_DIR, e.g. ".data/cache").
// Filed documents never change, so re-runs and backfill resumes skip the download.
const CACHE_DIR = process.env.EDGAR_CACHE_DIR;
const cacheable = (url: string) => !!CACHE_DIR && url.includes("/Archives/edgar/data/");
const cachePath = (url: string) => join(CACHE_DIR!, createHash("sha1").update(url).digest("hex"));

export async function getText(url: string): Promise<string> {
  if (cacheable(url) && existsSync(cachePath(url))) return readFileSync(cachePath(url), "utf8");
  const text = await (await request(url)).text();
  if (cacheable(url)) {
    mkdirSync(CACHE_DIR!, { recursive: true });
    writeFileSync(cachePath(url), text);
  }
  return text;
}

/** First `maxBytes` of a document (EDGAR ignores Range headers, so stream and stop). */
export async function getTextHead(url: string, maxBytes: number): Promise<string> {
  if (cacheable(url) && existsSync(cachePath(url))) return readFileSync(cachePath(url), "utf8").slice(0, maxBytes);
  const res = await request(url);
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export const edgarRequestCount = () => requestCount;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export const padCik = (cik: string | number) => String(cik).replace(/^0+/, "").padStart(10, "0");
export const trimCik = (cik: string | number) => String(cik).replace(/^0+/, "");
export const adshNoDashes = (adsh: string) => adsh.replace(/-/g, "");

export const archiveUrl = (cik: string, adsh: string, file: string) =>
  `https://www.sec.gov/Archives/edgar/data/${trimCik(cik)}/${adshNoDashes(adsh)}/${file}`;

export const filingIndexUrl = (cik: string, adsh: string) =>
  `https://www.sec.gov/Archives/edgar/data/${trimCik(cik)}/${adshNoDashes(adsh)}/${adsh}-index.htm`;

// ---------------------------------------------------------------------------
// Full-text search (efts.sec.gov). Covers 2001+; max 100 hits per page.
// ---------------------------------------------------------------------------

export interface FtsHit {
  id: string; // "<adsh>:<filename>"
  adsh: string;
  file: string;
  form: string;
  rootForm: string;
  fileType: string;
  fileDate: string;
  ciks: string[];
  displayNames: string[];
  sics: string[];
  items: string[];
  /**
   * Filers known to have been exchange-listed when this was filed (set by the backstop from `listedOn`): a company
   * bought in 2019 has no ticker in today's submissions, but it was listed then.
   */
  listedCiks?: string[];
}

interface FtsResponse {
  hits: {
    total: { value: number };
    hits: {
      _id: string;
      _source: {
        ciks: string[];
        display_names: string[];
        root_forms: string[];
        file_date: string;
        form: string;
        adsh: string;
        file_type: string;
        sics: string[];
        items?: string[] | null;
      };
    }[];
  };
}

export async function fullTextSearch(opts: { q: string; forms: string[]; from: string; to: string; ciks?: string[] }): Promise<FtsHit[]> {
  const out: FtsHit[] = [];
  for (let offset = 0; ; offset += 100) {
    const params = new URLSearchParams({
      q: opts.q,
      forms: opts.forms.join(","),
      dateRange: "custom",
      startdt: opts.from,
      enddt: opts.to,
      from: String(offset),
    });
    // Only these filers' documents ("0000050863", padded).
    if (opts.ciks?.length) params.set("ciks", opts.ciks.map(padCik).join(","));
    const res = await getJson<FtsResponse>(`https://efts.sec.gov/LATEST/search-index?${params}`);
    for (const h of res.hits.hits) {
      const s = h._source;
      out.push({
        id: h._id,
        adsh: s.adsh,
        file: h._id.split(":")[1],
        form: s.form,
        rootForm: s.root_forms?.[0] ?? s.form,
        fileType: s.file_type,
        fileDate: s.file_date,
        ciks: s.ciks,
        displayNames: s.display_names,
        sics: s.sics ?? [],
        items: s.items ?? [],
      });
    }
    const total = res.hits.total.value;
    if (offset + 100 >= Math.min(total, 10_000) || !res.hits.hits.length) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Company submissions (data.sec.gov)
// ---------------------------------------------------------------------------

export interface Submissions {
  cik: string;
  name: string;
  sic: string;
  sicDescription: string;
  tickers: string[];
  exchanges: string[];
  stateOfIncorporation: string;
  /** Names the registrant used before (EDGAR dates as ISO timestamps). */
  formerNames?: { name: string; from?: string; to?: string }[];
  addresses?: { business?: { stateOrCountry?: string | null; stateOrCountryDescription?: string | null } };
  filings: {
    recent: FilingColumns;
    /** Older filings, in pages: `recent` holds only the last ~1,000 filings (or one year). */
    files?: { name: string; filingFrom: string; filingTo: string }[];
  };
}

interface FilingColumns {
  accessionNumber: string[];
  filingDate: string[];
  form: string[];
  primaryDocument: string[];
  items: string[];
}

const rowsOf = (r: FilingColumns) =>
  r.accessionNumber.map((adsh, i) => ({ adsh, date: r.filingDate[i], form: r.form[i], primaryDocument: r.primaryDocument[i], items: r.items?.[i] ?? "" }));

/**
 * Every filing up to `until` (ISO date), oldest pages included: a company with thousands of filings since its 2015
 * IPO has the IPO's S-1 and 424B4 only in an older page. Newest first, like `recentFilings`.
 */
export async function filingsUntil(sub: Submissions, until: string) {
  const rows = recentFilings(sub);
  const oldestRecent = rows.reduce((m, f) => (f.date < m ? f.date : m), "9999");
  if (oldestRecent > until || rows.length >= 1000) {
    for (const page of sub.filings.files ?? []) {
      if (page.filingFrom > until) continue;
      rows.push(...rowsOf(await getJson<FilingColumns>(`https://data.sec.gov/submissions/${page.name}`)));
    }
  }
  const seen = new Set<string>();
  return rows.filter((f) => !seen.has(f.adsh) && seen.add(f.adsh)).sort((a, b) => b.date.localeCompare(a.date));
}

export const getSubmissions = (cik: string) => getJson<Submissions>(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`);

/**
 * The registrant's name on `date` (ISO). A target is often renamed after it is bought ("FLIR Systems" became
 * "Teledyne FLIR", "Beacon Roofing Supply" became "QXO Building Products"); a deal should show the name it had then.
 */
export function nameOn(sub: Pick<Submissions, "name" | "formerNames">, date: string): string {
  const later = (sub.formerNames ?? []).filter((f) => f.to && f.to.slice(0, 10) > date).sort((a, b) => a.to!.localeCompare(b.to!));
  const then = later.filter((f) => !f.from || f.from.slice(0, 10) <= date);
  // EDGAR's "from" is often when its records first noted the name, not when the company took it: RumbleOn's shows June
  // 2021, months after its March 2021 deal. With no name covering the date, the earliest one still in use after it.
  return then[0]?.name ?? later[0]?.name ?? sub.name;
}

/**
 * EDGAR's company-name lookup (the entity box of full-text search), best match first. Unlike the listed-company
 * file it also knows companies delisted since, such as targets of completed takeovers.
 */
export async function lookupCompanies(name: string): Promise<{ cik: string; name: string }[]> {
  const res = await getJson<{ hits?: { hits?: { _id: string; _source?: { entity?: string } }[] } }>(
    `https://efts.sec.gov/LATEST/search-index?keysTyped=${encodeURIComponent(name)}`,
  );
  return (res.hits?.hits ?? [])
    .filter((h) => h._source?.entity)
    .map((h) => ({ cik: trimCik(h._id), name: h._source!.entity!.replace(/\s*\([^)]*\)\s*$/, "") }));
}

/** Recent filings flattened into rows, newest first. */
export function recentFilings(sub: Submissions) {
  return rowsOf(sub.filings.recent);
}

export interface ListedCompany {
  cik: string;
  name: string;
  ticker: string;
  exchange: string | null;
}

/** Currently listed companies with their exchange (NYSE, Nasdaq, CBOE, OTC...). */
export async function getListedCompanies(): Promise<ListedCompany[]> {
  const raw = await getJson<{ fields: string[]; data: (string | number | null)[][] }>("https://www.sec.gov/files/company_tickers_exchange.json");
  const i = (f: string) => raw.fields.indexOf(f);
  return raw.data.map((r) => ({
    cik: String(r[i("cik")]),
    name: String(r[i("name")]),
    ticker: String(r[i("ticker")]),
    exchange: (r[i("exchange")] as string | null) ?? null,
  }));
}

/** Documents in a filing, from its index.json. */
export async function filingDocuments(cik: string, adsh: string) {
  const idx = await getJson<{ directory: { item: { name: string; size: string }[] } }>(
    `https://www.sec.gov/Archives/edgar/data/${trimCik(cik)}/${adshNoDashes(adsh)}/index.json`,
  );
  return idx.directory.item.map((i) => i.name);
}
