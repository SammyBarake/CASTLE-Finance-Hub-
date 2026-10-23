"use client";

import { useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyMark, Kpi, Kpis, PageHeading, SectorLabel, Select, StatusTag } from "@/components/ui/primitives";
import { EmptyRow, RowLink, ShowMore, TABLE_PAGE } from "@/components/ui/table";
import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";
import { useRecordActions, WatchButton } from "@/components/workspace/actions";
import { exportContext } from "@/components/export/excel";
import { downloadCsv, toCsv } from "@/lib/csv";
import { iposWorkbook } from "@/lib/excel/workbooks";
import { formatDate, formatRaise } from "@/lib/format";
import { sum } from "@/lib/metrics";
import { IPO_STAGES, SECTORS, type IpoStage, type Sector } from "@/lib/types";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });

export function IpoView() {
  const { data, freshness } = useHubData();
  const { openIpo } = useDetails();
  const { toast } = useUi();
  const { openRowMenu } = useRecordActions();
  const [stage, setStage] = useState<IpoStage | "all">("all");
  const [sector, setSector] = useState<Sector | "all">("all");
  const [bank, setBank] = useState("all");
  const [minRaise, setMinRaise] = useState("");
  const [sort, setSort] = useState<"date" | "raise">("date");
  const [shown, setShown] = useState(TABLE_PAGE);
  // Any filter change starts the list from the top again.
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setShown(TABLE_PAGE));

  const banks = useMemo(() => [...new Set(data.ipos.flatMap((i) => i.underwriters))].sort(), [data.ipos]);
  // The underwriter / sector / size filters; the stage tabs count within them, so a filtered list's tabs add up.
  const filtered = useMemo(() => {
    const min = minRaise ? Number(minRaise) * 1e6 : null;
    return data.ipos.filter(
      (i) => (sector === "all" || i.sector === sector) && (bank === "all" || i.underwriters.includes(bank)) && (min == null || (i.expectedRaiseUsd ?? 0) >= min),
    );
  }, [data.ipos, sector, bank, minRaise]);
  const rows = useMemo(
    () =>
      filtered
        .filter((i) => stage === "all" || i.stage === stage)
        .sort((a, b) => (sort === "raise" ? (b.expectedRaiseUsd ?? -1) - (a.expectedRaiseUsd ?? -1) : b.filedDate.localeCompare(a.filedDate))),
    [filtered, stage, sort],
  );
  const tabCount = (s: IpoStage | "all") => (s === "all" ? filtered.length : filtered.filter((i) => i.stage === s).length);
  // The KPIs summarise the whole pipeline, whatever the table shows.
  const filed = data.ipos.filter((i) => i.stage === "Filed");
  const count = (s: IpoStage) => data.ipos.filter((i) => i.stage === s).length;

  const exportRows = () => {
    if (!rows.length) return toast("No rows to export.");
    const csv = toCsv(
      ["Company", "Ticker", "Sector", "Filing date", "Priced date", "Expected raise (USD)", "Offer price (USD)", "Underwriters", "Stage"],
      rows.map((i) => [i.company.name, i.company.ticker, i.sector, i.filedDate, i.pricedDate, i.expectedRaiseUsd, i.offerPrice, i.underwriters.join("; "), i.stage]),
      data.isSample,
    );
    downloadCsv(csv, `Castle_IPO_Pipeline${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${rows.length} rows exported.`);
  };

  return (
    <>
      <PageHeading
        title="IPO Pipeline"
        subtitle={`U.S. public offerings · ${monthYear(data.asOf)}`}
        onExport={exportRows}
        live={() => {
          const query = new URLSearchParams();
          if (stage !== "all") query.set("stage", stage);
          if (sector !== "all") query.set("sector", sector);
          if (bank !== "all") query.set("bank", bank);
          if (minRaise) query.set("min", minRaise);
          if (sort === "raise") query.set("sort", "raise");
          const q = query.toString();
          return { path: `/api/live/ipos.csv${q ? `?${q}` : ""}` };
        }}
        excel={() =>
          rows.length
            ? iposWorkbook(rows, exportContext(data), {
                selection: [
                  `Stage: ${stage === "all" ? "All companies" : stage}`,
                  `Underwriter: ${bank === "all" ? "Any" : bank}`,
                  `Sector: ${sector === "all" ? "All sectors" : sector}`,
                  `Minimum expected raise: ${minRaise ? `${minRaise}M` : "Any"}`,
                ],
              })
            : null
        }
      />

      <Kpis label="IPO summary">
        <Kpi label="Filed companies" value={filed.length} note="Awaiting pricing" />
        <Kpi label="Expected raise" value={formatRaise(sum(filed.map((i) => i.expectedRaiseUsd ?? 0)))} note="Filed companies with a disclosed size" />
        <Kpi label="Priced" value={count("Priced")} note="Priced in the last 7 days" />
        <Kpi label="Trading" value={count("Trading")} note="Recent listings" />
      </Kpis>

      <section className="panel">
        <div className="tabs" role="group" aria-label="IPO stage">
          {(["all", ...IPO_STAGES] as const).map((s) => (
            <button key={s} type="button" className="tab" aria-pressed={stage === s} onClick={() => reset(setStage)(s)}>
              {s === "all" ? "All companies" : s}
              <span>{tabCount(s)}</span>
            </button>
          ))}
        </div>
        <div className="table-tools">
          <span className="dim" style={{ fontSize: 10 }}>
            {rows.length} companies
          </span>
          <div className="table-filters">
            <Select id="ipo-bank" label="Underwriter" value={bank} onChange={reset(setBank)} options={[{ value: "all", label: "All underwriters" }, ...banks.map((b) => ({ value: b, label: b }))]} />
            <Select
              id="ipo-min"
              label="Minimum expected raise"
              value={minRaise}
              onChange={reset(setMinRaise)}
              options={[
                { value: "", label: "Any raise" },
                { value: "100", label: "$100M+" },
                { value: "250", label: "$250M+" },
                { value: "500", label: "$500M+" },
                { value: "1000", label: "$1B+" },
              ]}
            />
            <Select id="ipo-sector" label="IPO sector" value={sector} onChange={reset(setSector)} options={[{ value: "all" as const, label: "All sectors" }, ...SECTORS.map((s) => ({ value: s, label: s }))]} />
            <Select
              id="ipo-sort"
              label="Sort IPOs"
              value={sort}
              onChange={setSort}
              options={[
                { value: "date", label: "Newest first" },
                { value: "raise", label: "Largest raise" },
              ]}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">IPO pipeline</caption>
            <thead>
              <tr>
                <th className="cell-end">
                  <span className="sr-only">Watch</span>
                </th>
                <th scope="col">COMPANY</th>
                <th scope="col">SECTOR</th>
                <th scope="col">FILING DATE</th>
                <th scope="col" className="right">EXPECTED RAISE</th>
                <th scope="col">LEAD UNDERWRITERS</th>
                <th scope="col">STAGE</th>
                <th className="cell-end">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((i) => (
                <RowLink key={i.id} label={`${i.company.name} IPO`} onOpen={() => openIpo(i)} onMenu={(at) => openRowMenu("ipo", i, at)} className={freshness.freshIds.has(i.id) ? "row-fresh" : ""}>
                  <td className="cell-end" onClick={(e) => e.stopPropagation()}>
                    <WatchButton kind="ipo" id={i.id} label={i.company.name} />
                  </td>
                  <td className="company">
                    <span className="company-line">
                      <CompanyMark name={i.company.name} />
                      <span>
                        {i.company.name}
                        {i.company.ticker && <small>{i.company.ticker}</small>}
                      </span>
                    </span>
                  </td>
                  <td>
                    <SectorLabel sector={i.sector} />
                  </td>
                  <td className="table-date">{formatDate(i.filedDate)}</td>
                  <td className="right table-value">{formatRaise(i.expectedRaiseUsd)}</td>
                  <td className="table-underwriters">
                    {i.underwriters.length ? i.underwriters.slice(0, 2).join(" · ") + (i.underwriters.length > 2 ? ` +${i.underwriters.length - 2}` : "") : <span className="dim">—</span>}
                  </td>
                  <td>
                    <StatusTag status={i.stage} />
                  </td>
                  <td className="cell-end">
                    <button
                      type="button"
                      className="row-icon"
                      aria-label={`Actions for ${i.company.name}`}
                      aria-haspopup="menu"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRowMenu("ipo", i, { anchor: e.currentTarget });
                      }}
                    >
                      <Icon name="dots" />
                    </button>
                  </td>
                </RowLink>
              ))}
              {!rows.length && <EmptyRow colSpan={8}>No companies in this selection.</EmptyRow>}
            </tbody>
          </table>
        </div>
        <ShowMore shown={shown} total={rows.length} onMore={() => setShown((n) => n + TABLE_PAGE)} />
        <div className="panel-foot">
          <span>Expected gross proceeds, before fees</span>
          <span>USD</span>
        </div>
      </section>
    </>
  );
}
