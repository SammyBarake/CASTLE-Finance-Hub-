"use client";

import { useMemo } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { Icon } from "@/components/ui/Icon";
import { AboutData, CompanyMark, Kpi, Kpis, PageHeading, PageLink, PanelHead, StatusTag } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { edgarCompanyUrl, findCompany, type CompanyBank } from "@/lib/companies";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate, formatDateLong, formatPct, formatRaise, formatUsd } from "@/lib/format";

const bankRoles = (b: CompanyBank) =>
  [b.buySide && `Buy side ×${b.buySide}`, b.sellSide && `Sell side ×${b.sellSide}`, b.ipo && `IPO ×${b.ipo}`].filter(Boolean).join(" · ");

export function CompanyView({ id }: { id: string }) {
  const { data } = useHubData();
  const { openDeal, openIpo, openAdvisorByName } = useDetails();
  const { toast } = useUi();
  const profile = useMemo(() => findCompany(data, id), [data, id]);

  if (!profile) {
    return (
      <>
        <PageHeading title="Company not found" subtitle="No deal or IPO in Castle's feed involves this company." />
        <section className="panel">
          <div className="empty-small">
            Castle covers deals since 2021, IPO filings from the past year and activist stakes since late 2024. <PageLink href="/deal-flow">Browse deal flow</PageLink>
          </div>
        </section>
      </>
    );
  }

  const { company, deals, ipos, banks, filings } = profile;
  const stakes = (data.activists ?? []).filter((s) => company.cik && s.company.cik?.replace(/^0+/, "") === company.cik.replace(/^0+/, ""));
  const bought = deals.filter((d) => d.role === "Acquirer");
  const sold = deals.filter((d) => d.role === "Target");
  const isRanked = (name: string) => data.leagueTable.entries.some((e) => e.advisor.name === name);
  const subtitle = [company.ticker, profile.sector, profile.industry].filter(Boolean).join(" · ") || "Company profile";

  const exportRows = () => {
    const csv = toCsv(
      ["Announced", "Role", "Counterparty", "Value (USD)", "Premium (%)", "Consideration", "Status"],
      deals.map(({ deal, role, counterparty }) => [deal.announcedDate, role, counterparty.name, deal.valueUsd, deal.premiumPct, deal.consideration, deal.status]),
      data.isSample,
    );
    downloadCsv(csv, `Castle_${company.name.replace(/[^\w]+/g, "_")}_Deals.csv`);
    toast(`${deals.length} rows exported.`);
  };

  return (
    <>
      <PageHeading title={company.name} subtitle={subtitle} onExport={deals.length ? exportRows : undefined} exportLabel="Export this company's deals as CSV" />

      <Kpis label="Company summary">
        <Kpi label="Acquisitions" value={bought.length} note={bought.length ? `${formatUsd(profile.acquiredValueUsd)} disclosed value` : "None in Castle's feed"} />
        <Kpi label="Sale process" value={profile.saleStatus ? <StatusTag status={profile.saleStatus} /> : "None"} note={sold.length ? `Target in ${sold.length} deal${sold.length > 1 ? "s" : ""}` : "Not a target"} text />
        <Kpi label="Banks used" value={banks.length} note={banks[0] ? `Most often ${banks[0].name}` : "None disclosed"} />
        <Kpi label="Latest activity" value={profile.latestActivity ? formatDate(profile.latestActivity.date) : "—"} note={profile.latestActivity?.label ?? "No activity"} text />
      </Kpis>

      <section className="panel">
        <PanelHead title="Deal history" subtitle={`${deals.length} transaction${deals.length === 1 ? "" : "s"} · As acquirer and target`} />
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Deals involving {company.name}</caption>
            <thead>
              <tr>
                <th scope="col">ANNOUNCED</th>
                <th scope="col">ROLE</th>
                <th scope="col">COUNTERPARTY</th>
                <th scope="col" className="right">VALUE</th>
                <th scope="col" className="right">PREMIUM</th>
                <th scope="col">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {deals.map(({ deal, role, counterparty }) => (
                <RowLink key={deal.id} label={`${deal.acquirer.name} to acquire ${deal.target.name}`} onOpen={() => openDeal(deal)}>
                  <td className="table-date">{formatDate(deal.announcedDate)}</td>
                  <td className="dim">{role === "Acquirer" ? "Buyer" : "Target"}</td>
                  <td className="company">
                    <span className="company-line">
                      <CompanyMark name={counterparty.name} />
                      <CompanyLink company={counterparty} />
                    </span>
                  </td>
                  <td className="right table-value">{formatUsd(deal.valueUsd)}</td>
                  <td className="right mono">{formatPct(deal.premiumPct)}</td>
                  <td>
                    <StatusTag status={deal.status} />
                  </td>
                </RowLink>
              ))}
              {!deals.length && <EmptyRow colSpan={6}>No M&A activity in Castle&apos;s feed.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col company-grid">
        <section className="panel">
          <PanelHead title="Banks" subtitle="Advisors and underwriters that worked for this company" />
          {banks.map((b) => (
            <button key={b.name} type="button" className="preview-row" disabled={!isRanked(b.name)} onClick={() => openAdvisorByName(b.name)}>
              <span className="preview-company">
                <CompanyMark name={b.name} />
                <span>
                  <strong>{b.name}</strong>
                  <small>{bankRoles(b)}</small>
                </span>
              </span>
              {isRanked(b.name) && <Icon name="right" />}
            </button>
          ))}
          {!banks.length && <div className="empty-small">No advisors or underwriters named in its filings.</div>}
        </section>

        <section className="panel">
          <PanelHead title="SEC filings" subtitle="Source documents behind these records">
            {company.cik && (
              <a className="small-link" href={edgarCompanyUrl(company.cik)} target="_blank" rel="noreferrer">
                All on EDGAR
                <Icon name="external" />
              </a>
            )}
          </PanelHead>
          <div className="company-filings">
            {filings.slice(0, 12).map((f) => (
              <a key={f.url} className="filing-link" href={f.url} target="_blank" rel="noreferrer">
                <span>
                  {f.form}
                  <small className="dim" style={{ marginLeft: 8 }}>
                    {formatDateLong(f.filedDate)}
                  </small>
                </span>
                <Icon name="external" />
              </a>
            ))}
            {!filings.length && <p className="dim">No linked filings.</p>}
          </div>
        </section>
      </div>

      {!!ipos.length && (
        <section className="panel">
          <PanelHead title="IPO" subtitle="Registration and pricing" />
          {ipos.map((i) => (
            <button key={i.id} type="button" className="preview-row" onClick={() => openIpo(i)}>
              <span className="preview-company">
                <span>
                  <strong>
                    Filed {formatDateLong(i.filedDate)}
                    {i.pricedDate ? ` · Priced ${formatDateLong(i.pricedDate)}` : ""}
                  </strong>
                  <small>{i.underwriters.length ? i.underwriters.join(", ") : "Bookrunners not identified"}</small>
                </span>
              </span>
              <span className="preview-value">
                {formatRaise(i.expectedRaiseUsd)}
                <small>{i.stage}</small>
              </span>
            </button>
          ))}
        </section>
      )}

      {!!stakes.length && (
        <section className="panel">
          <PanelHead title="Activist investors" subtitle="5%+ stakes filed on Schedule 13D by investors seeking change" />
          {stakes.map((s) => (
            <a key={s.id} className="preview-row" href={s.url} target="_blank" rel="noreferrer">
              <span className="preview-company">
                <span>
                  <strong>{s.investor.name}</strong>
                  <small>
                    Filed {formatDateLong(s.filedDate)}
                    {s.aims.length ? ` · ${s.aims.join(", ")}` : ""}
                  </small>
                </span>
              </span>
              <span className="preview-value">
                {s.percent != null ? `${s.percent.toFixed(1)}%` : "—"}
                <small>stake</small>
              </span>
            </a>
          ))}
        </section>
      )}

      <AboutData>
        <p>
          {data.isSample
            ? "Sample data · fictional company."
            : "Built from the deals, IPOs and activist stakes Castle has detected in SEC filings since 2021. Check the source documents before relying on any figure."}
        </p>
      </AboutData>
    </>
  );
}
