/**
 * Buyer types: strategic (an operating company) vs. private equity / financial sponsor.
 * Classic M&A lesson: strategics can usually pay more because they expect synergies.
 */
import type { Deal } from "./types";

export type BuyerType = "Strategic" | "Private equity";

/** Well-known financial sponsors (private equity, infrastructure and growth funds). */
const SPONSORS =
  /\b(KKR|Kohlberg Kravis|Blackstone|Apollo|Carlyle|TPG|Bain Capital|Thoma Bravo|Silver Lake|Vista Equity|Advent International|Warburg Pincus|H\.?I\.?G\.? Capital|Clayton,? Dubilier|CD&R|EQT|Permira|Hellman & Friedman|Brookfield|GTCR|Francisco Partners|Clearlake|Sycamore|Searchlight|Stone Point|Platinum Equity|Kinderhook|Veritas Capital|Genstar|Insight Partners|Cinven|CVC|Ares Management|Oak Hill|Madison Dearborn|Roark|Leonard Green|Sixth Street|Elliott|Starboard|Arsenal Capital|American Securities|Audax|Berkshire Partners|Bernhard Capital|Charlesbank|Cerberus|Crestview|Gores|Grain Management|Harvest Partners|Hg\b|Irving Place|KPS Capital|L Catterton|Lindsay Goldberg|New Mountain|Onex|Patient Square|Providence Equity|Quantum Energy|Riverstone|Siris|Stonepeak|Summit Partners|Towerbrook|Trive|Vector Capital|Welsh,? Carson|Concentra Biosciences|Tang Capital|Butterfly Equity|Battery Ventures|Bayview|Global Infrastructure Partners|Macquarie|Arclight|I Squared|DigitalBridge|Public Investment Fund|GIC|Temasek|Mubadala|CPP Investments|Ontario Teachers|OMERS|CDPQ|3G Capital|Centerbridge|Haveli|Lone Star|Deerfield|ARCHIMED|TriArtisan|Abry|Ampersand|GHO Capital|Transom|Vector Capital|Accel-KKR|Siris|Thomas H\.? Lee|THL|Golden Gate Capital|Court Square|Kohlberg|Littlejohn|Wind Point|Pamlico|One Rock|Sentinel Capital|Carlyle)\b/i;

/** Name shapes typical of funds and buyout vehicles ("… Capital Partners", "… Equity LP", "Madison Parent Inc."). */
// ("Partners, LP" alone is not enough: pipeline MLPs like Western Midstream Partners use it too.)
const FUND_SHAPE = /\b(Capital Partners|Equity Partners|Private Equity|Investment Partners|Capital Management|Capital Advisors|Capital,? L\.?P\.?|Equity,? L\.?P\.?|Fund\b|Investors?\b|Investor Group|Buyer Group|Consortium|Family Office|SPV\b)\b/i;
const VEHICLE = /\b(Parent|ParentCo|Purchaser|BidCo|Bidco|AcquireCo|Acquisition (?:Corp|Co|LLC|Inc)|HoldCo|Holdco|TopCo|Topco|Merger Sub)\b/;

export function buyerType(deal: Deal): BuyerType {
  const name = deal.acquirer.name;
  if (SPONSORS.test(name) || FUND_SHAPE.test(name)) return "Private equity";
  // A buyout vehicle that isn't itself a listed company is almost always sponsor-backed.
  if (!deal.acquirer.cik && !deal.acquirer.ticker && VEHICLE.test(name)) return "Private equity";
  return "Strategic";
}

const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface BuyerGroup {
  type: BuyerType;
  count: number;
  sharePct: number;
  medianPremium: number | null;
  medianEvEbitda: number | null;
  medianValueUsd: number | null;
  cashPct: number | null;
  topBuyers: { name: string; count: number; valueUsd: number; deal: Deal }[];
}

export function buyerGroups(deals: Deal[]): BuyerGroup[] {
  const live = deals.filter((d) => d.status !== "Terminated");
  return (["Strategic", "Private equity"] as BuyerType[]).map((type) => {
    const ds = live.filter((d) => buyerType(d) === type);
    const nums = (f: (d: Deal) => number | null) => ds.map(f).filter((v): v is number => v != null);
    const known = ds.filter((d) => d.consideration);
    const byName = new Map<string, { name: string; count: number; valueUsd: number; deal: Deal }>();
    for (const d of ds) {
      if (/^(?:the\s+)?(?:investor group|buyer group|consortium)$/i.test(d.acquirer.name.trim()) || VEHICLE.test(d.acquirer.name)) continue;
      const e = byName.get(d.acquirer.name) ?? { name: d.acquirer.name, count: 0, valueUsd: 0, deal: d };
      e.count++;
      e.valueUsd += d.valueUsd ?? 0;
      byName.set(d.acquirer.name, e);
    }
    return {
      type,
      count: ds.length,
      sharePct: live.length ? Math.round((ds.length / live.length) * 100) : 0,
      medianPremium: median(nums((d) => d.premiumPct)),
      medianEvEbitda: median(nums((d) => d.evEbitda)),
      medianValueUsd: median(nums((d) => d.valueUsd)),
      cashPct: known.length ? Math.round((known.filter((d) => d.consideration === "Cash").length / known.length) * 100) : null,
      topBuyers: [...byName.values()].sort((a, b) => b.count - a.count || b.valueUsd - a.valueUsd).slice(0, 6),
    };
  });
}

export function buyerInsights(groups: BuyerGroup[]): string[] {
  const [st, pe] = groups;
  const out: string[] = [];
  if (!st.count || !pe.count) return out;
  if (st.medianPremium != null && pe.medianPremium != null) {
    const gap = st.medianPremium - pe.medianPremium;
    out.push(
      Math.abs(gap) < 3
        ? `Premiums are close: ${Math.round(st.medianPremium)}% strategic vs ${Math.round(pe.medianPremium)}% private equity (median).`
        : `${gap > 0 ? "Strategic" : "Private-equity"} buyers paid the higher median premium (${Math.round(st.medianPremium)}% strategic vs ${Math.round(pe.medianPremium)}% private equity).`,
    );
  }
  if (st.cashPct != null && pe.cashPct != null) out.push(`All-cash: ${pe.cashPct}% of private-equity deals vs ${st.cashPct}% of strategic deals.`);
  if (st.medianValueUsd != null && pe.medianValueUsd != null)
    out.push(`${pe.sharePct}% of deals had a private-equity buyer, at a median size of ${usd(pe.medianValueUsd)} vs ${usd(st.medianValueUsd)} for strategics.`);
  return out;
}
