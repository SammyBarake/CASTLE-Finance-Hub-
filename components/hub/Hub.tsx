"use client";

import { useEffect, useMemo, useState } from "react";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Sidebar, type NavId } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { useUi } from "@/components/ui/UiProvider";
import { dealsToCsv, downloadCsv } from "@/lib/csv";
import { buildVolumeMatrix, ipoPipelineSummary, medianPremium, ytdSummary } from "@/lib/metrics";
import { matchAdvisor, matchDeal, matchIpo, type DealFilters } from "@/lib/search";
import type { HubData } from "@/lib/types";
import { AdvisorsTable } from "./AdvisorsTable";
import { DealFlowTable } from "./DealFlowTable";
import { DealVolumePanel } from "./DealVolumePanel";
import { aboutDetail, advisorDetail, dealDetail, ipoDetail } from "./details";
import { IpoPipelineTable } from "./IpoPipelineTable";
import { KpiStrip } from "./KpiStrip";
import { ValuationMoves } from "./ValuationMoves";

/** The hub page: owns search, filters and navigation state; everything else is presentational. */
export function Hub({ data }: { data: HubData }) {
  const { openDialog, toast } = useUi();
  const [rawQuery, setRawQuery] = useState("");
  const [sector, setSector] = useState<DealFilters["sector"]>("all");
  const [status, setStatus] = useState<DealFilters["status"]>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavId>("hub");

  const query = rawQuery.toLowerCase().trim();
  const filters: DealFilters = { query, sector, status };

  // Derived figures (independent of search).
  const matrix = useMemo(() => buildVolumeMatrix(data.monthlyVolume), [data.monthlyVolume]);
  const ytd = useMemo(() => ytdSummary(matrix), [matrix]);
  const ipoSummary = ipoPipelineSummary(data.ipos);

  // Filtered views.
  const deals = data.deals.filter((d) => matchDeal(d, filters));
  const ipos = data.ipos.filter((i) => matchIpo(i, query));
  const advisors = data.leagueTable.entries.filter((e) => matchAdvisor(e, query));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (id: NavId) => {
    setActiveNav(id);
    setMenuOpen(false);
  };

  const showAbout = () => {
    setMenuOpen(false);
    openDialog(aboutDetail(data.isSample, data.deals.length));
  };

  const resetFilters = () => {
    setSector("all");
    setStatus("all");
    setRawQuery("");
  };

  const jumpToFirstResult = () => {
    const row = document.querySelector<HTMLElement>("tr.row-link");
    if (!row) return toast("No results. Try a company, bank, sector, or ticker.");
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.focus({ preventScroll: true });
  };

  const exportDeals = () => {
    if (!deals.length) return toast("No deals to export. Clear the filters first.");
    downloadCsv(dealsToCsv(deals, data.isSample), data.isSample ? "Castle_Sample_Deals.csv" : "Castle_Deals.csv");
    toast(`Exported ${deals.length} ${data.isSample ? "sample " : ""}transactions.`);
  };

  return (
    <>
      {menuOpen && <div className="fixed inset-0 z-45 bg-black/60 phone:hidden" onClick={() => setMenuOpen(false)} />}
      <Sidebar
        open={menuOpen}
        active={activeNav}
        dealCount={data.deals.length}
        onNavigate={navigate}
        onAbout={showAbout}
        onSoon={(feature) => {
          setMenuOpen(false);
          toast(`${feature} is coming soon.`);
        }}
      />

      <div id="hub" className="ml-[208px] min-w-0 max-laptop:ml-[182px] max-tablet:ml-[171px] max-phone:ml-0">
        <Topbar
          query={rawQuery}
          onQueryChange={setRawQuery}
          onSubmit={jumpToFirstResult}
          asOf={data.asOf}
          isSample={data.isSample}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen((o) => !o)}
        />

        <main className="mx-auto max-w-[1770px] px-[29px] pt-7 wide:pt-[31px] max-laptop:px-[22px] max-phone:px-4 max-phone:pt-[22px]">
          <PageHeader asOf={data.asOf} onExport={exportDeals} />

          {query && (
            <div
              role="status"
              aria-live="polite"
              className="-mt-1.5 mb-[18px] flex items-center justify-between rounded-[5px] border border-[#393349] bg-[#1b1826] px-3.5 py-2.5 text-[11px] text-[#c1b6df] max-phone:text-[10px]"
            >
              <span>
                {deals.length + ipos.length + advisors.length} matches for “{rawQuery.trim()}” across deals, IPOs, and advisors
              </span>
              <button type="button" onClick={() => setRawQuery("")} className="py-px text-[10px] text-[#ccc3e6] underline">
                Clear search
              </button>
            </div>
          )}

          <KpiStrip ytd={ytd} medianPremiumPct={medianPremium(data.deals)} ipoRaiseUsd={ipoSummary.expectedRaiseUsd} ipoFiledCount={ipoSummary.filedCount} />
          <DealVolumePanel matrix={matrix} isSample={data.isSample} />
          <ValuationMoves valuations={data.valuations} />
          <DealFlowTable
            deals={deals}
            totalCount={data.deals.length}
            filters={filters}
            onFiltersChange={(f) => {
              if (f.sector) setSector(f.sector);
              if (f.status) setStatus(f.status);
            }}
            onSelect={(d) => openDialog(dealDetail(d, data.isSample))}
            onReset={resetFilters}
          />
          <div className="grid grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] gap-[21px] max-laptop:grid-cols-1 max-phone:gap-[17px]">
            <IpoPipelineTable ipos={ipos} totalCount={data.ipos.length} onSelect={(i) => openDialog(ipoDetail(i, data.isSample))} />
            <AdvisorsTable
              entries={advisors}
              allEntries={data.leagueTable.entries}
              period={data.leagueTable.period}
              onSelect={(e, rank) => openDialog(advisorDetail(e, rank, data.leagueTable.period, data.deals, data.isSample))}
            />
          </div>
          <Footer isSample={data.isSample} onAbout={showAbout} />
        </main>
      </div>
    </>
  );
}
