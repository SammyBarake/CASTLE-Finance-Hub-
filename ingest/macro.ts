/**
 * World Economies: GDP growth and inflation from the IMF World Economic Outlook
 * (DataMapper API) and central-bank policy rates from the BIS. Both are free and
 * need no API key. These aren't SEC requests, so they bypass the EDGAR client.
 */
import type { Economy, Macro, Region } from "../lib/types";

interface EconomyDef {
  code: string;
  name: string;
  region: Region;
  imf: string;
  bis: string;
}

export const ECONOMIES: EconomyDef[] = [
  { code: "US", name: "United States", region: "Americas", imf: "USA", bis: "US" },
  { code: "CA", name: "Canada", region: "Americas", imf: "CAN", bis: "CA" },
  { code: "MX", name: "Mexico", region: "Americas", imf: "MEX", bis: "MX" },
  { code: "BR", name: "Brazil", region: "Americas", imf: "BRA", bis: "BR" },
  { code: "EA", name: "Euro area", region: "Europe", imf: "EURO", bis: "XM" },
  { code: "UK", name: "United Kingdom", region: "Europe", imf: "GBR", bis: "GB" },
  { code: "JP", name: "Japan", region: "Asia-Pacific", imf: "JPN", bis: "JP" },
  { code: "CN", name: "China", region: "Asia-Pacific", imf: "CHN", bis: "CN" },
  { code: "IN", name: "India", region: "Asia-Pacific", imf: "IND", bis: "IN" },
  { code: "KR", name: "South Korea", region: "Asia-Pacific", imf: "KOR", bis: "KR" },
  { code: "AU", name: "Australia", region: "Asia-Pacific", imf: "AUS", bis: "AU" },
];

const IMF = "https://www.imf.org/external/datamapper/api/v1";
const BIS = "https://stats.bis.org/api/v1/data/WS_CBPOL";

type ImfSeries = Record<string, Record<string, number>>;

/** Value for one economy and year from an IMF DataMapper indicator response. */
export function imfValue(series: ImfSeries, imfCode: string, year: number): number | null {
  const v = series[imfCode]?.[String(year)];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

/** Latest policy rate per BIS area code from a `format=csv&detail=dataonly` response. */
export function parseBisCsv(csv: string): Map<string, { rate: number; date: string }> {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(",") ?? [];
  const col = (name: string) => header.indexOf(name);
  const [area, period, value] = [col("REF_AREA"), col("TIME_PERIOD"), col("OBS_VALUE")];
  const out = new Map<string, { rate: number; date: string }>();
  for (const line of lines) {
    const cells = line.split(",");
    if (!cells[value]?.trim()) continue; // Number("") would read as 0%
    const rate = Number(cells[value]);
    const date = cells[period];
    if (!cells[area] || !Number.isFinite(rate) || !date) continue;
    const prev = out.get(cells[area]);
    if (!prev || date > prev.date) out.set(cells[area], { rate, date });
  }
  return out;
}

async function get(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT ?? "Castle research", Accept: accept },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

export async function fetchMacro(now = new Date()): Promise<Macro> {
  const year = now.getUTCFullYear();
  const [gdpRaw, cpiRaw, bisRaw] = await Promise.all([
    get(`${IMF}/NGDP_RPCH`, "application/json"),
    get(`${IMF}/PCPIPCH`, "application/json"),
    get(`${BIS}/D.${ECONOMIES.map((e) => e.bis).join("+")}/all?lastNObservations=1&format=csv&detail=dataonly`, "text/csv"),
  ]);
  const gdp = (JSON.parse(gdpRaw).values?.NGDP_RPCH ?? {}) as ImfSeries;
  const cpi = (JSON.parse(cpiRaw).values?.PCPIPCH ?? {}) as ImfSeries;
  const rates = parseBisCsv(bisRaw);

  const economies: Economy[] = ECONOMIES.map((e) => ({
    code: e.code,
    name: e.name,
    region: e.region,
    gdpGrowth: imfValue(gdp, e.imf, year),
    gdpGrowthPrior: imfValue(gdp, e.imf, year - 1),
    inflation: imfValue(cpi, e.imf, year),
    inflationPrior: imfValue(cpi, e.imf, year - 1),
    policyRate: rates.get(e.bis)?.rate ?? null,
    policyRateDate: rates.get(e.bis)?.date ?? null,
  }));

  const filled = economies.filter((e) => e.gdpGrowth != null || e.policyRate != null).length;
  if (filled < ECONOMIES.length / 2) throw new Error(`macro sources returned too little data (${filled}/${ECONOMIES.length} economies)`);
  return { asOf: now.toISOString(), forecastYear: year, economies };
}
