import type { Sector } from "../lib/types";

/**
 * Map an SEC SIC code onto Castle's five display sectors.
 *
 * The design has five sectors, so adjacent industries are folded in:
 *   Tech        software, hardware, semis, telecom & media
 *   Healthcare  pharma, biotech, devices, services
 *   Energy      oil & gas, utilities, mining & materials
 *   Financials  banks, insurance, asset managers, REITs & real estate
 *   Industrials manufacturing, transport, business services, consumer
 * The raw SIC description is stored on each record as `industry` so the
 * mapping can be refined later without re-ingesting.
 */
export function sectorForSic(sicRaw: string | number | null | undefined, name = ""): Sector {
  const sic = Number(sicRaw);
  // New registrants sometimes have no SIC yet; fall back to the name.
  if (!sic) {
    if (/\b(Banc|Bancorp|Bank|Bancshares|Financial|Insurance|Capital|Credit|Savings)\b/i.test(name)) return "Financials";
    if (/\b(Therapeutics|Bio|Pharma|Medical|Health)/i.test(name)) return "Healthcare";
    if (/\b(Energy|Power|Oil|Gas|Mining|Resources|Metals)\b/i.test(name)) return "Energy";
    if (/\b(Software|Technolog|Networks|Semiconductor|AI|Data|Digital|Cloud)\b/i.test(name)) return "Tech";
    return "Industrials";
  }

  const inRange = (lo: number, hi: number) => sic >= lo && sic <= hi;

  // Healthcare
  if (inRange(2833, 2836) || inRange(3841, 3851) || inRange(8000, 8099) || sic === 5122 || sic === 5047 || sic === 8731 || sic === 3826) {
    return "Healthcare";
  }
  // Tech
  if (
    inRange(3570, 3579) ||
    inRange(3661, 3679) ||
    inRange(3812, 3812) ||
    inRange(3820, 3825) ||
    inRange(3827, 3829) ||
    inRange(4800, 4899) ||
    inRange(7370, 7379) ||
    inRange(2710, 2741) ||
    inRange(7810, 7829) ||
    sic === 3695 ||
    sic === 5045 ||
    sic === 5065 ||
    sic === 3577
  ) {
    return "Tech";
  }
  // Energy, utilities, mining & materials
  if (
    inRange(1000, 1499) ||
    inRange(2800, 2829) ||
    inRange(2850, 2899) ||
    inRange(2900, 2999) ||
    inRange(3300, 3399) ||
    inRange(4900, 4991) ||
    inRange(4610, 4619) ||
    sic === 5171 ||
    sic === 5172 ||
    inRange(3530, 3533)
  ) {
    return "Energy";
  }
  // Financials & real estate
  if (inRange(6000, 6799) && sic !== 6770) return "Financials";
  if (sic === 6770) return "Financials"; // blank-check shells

  return "Industrials";
}
