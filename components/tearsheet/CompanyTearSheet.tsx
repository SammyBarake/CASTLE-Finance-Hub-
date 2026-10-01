import type { CompanyProfile } from "@/lib/companies";
import { formatDateLong, formatPct, formatRaise, formatUsd } from "@/lib/format";
import type { ActivistStake, HubData } from "@/lib/types";
import { SheetFigures, SheetRows, SheetSection, TearSheet } from "./TearSheet";

export function CompanyTearSheet({ profile, data }: { profile: CompanyProfile; data: HubData }) {
  const { company } = profile;
  const cik = company.cik?.replace(/^0+/, "");
  const stakes: ActivistStake[] = (data.activists ?? []).filter((s) => cik && s.company.cik?.replace(/^0+/, "") === cik).slice(0, 4);
  const bought = profile.deals.filter((d) => d.role === "Acquirer");
  const sold = profile.deals.find((d) => d.role === "Target");
  const ipo = profile.ipos[0];
  const topBank = profile.banks[0];

  return (
    <TearSheet
      kind="Company tear sheet"
      asOf={data.asOf}
      sources={
        <ul>
          {profile.filings.slice(0, 6).map((f) => (
            <li key={f.url}>
              {f.form} · {formatDateLong(f.filedDate)}
            </li>
          ))}
        </ul>
      }
    >
      <div className="sheet-title">
        <span className="sheet-eyebrow">
          Company{profile.sector ? ` · ${profile.sector}` : ""}
          {profile.industry ? ` · ${profile.industry}` : ""}
        </span>
        <h1>{company.name}</h1>
        <p>
          {[company.ticker, cik ? `CIK ${cik}` : null, profile.latestActivity ? `Latest: ${profile.latestActivity.label}, ${formatDateLong(profile.latestActivity.date)}` : null].filter(Boolean).join(" · ")}
        </p>
      </div>

      <SheetFigures
        items={[
          ["Acquisitions", String(bought.length), profile.acquiredValueUsd ? `${formatUsd(profile.acquiredValueUsd)} disclosed` : undefined],
          ["Sale process", sold ? sold.deal.status : "None", sold ? `To ${sold.counterparty.name}` : "Not a target"],
          ["Banks used", String(profile.banks.length), topBank ? `Most often ${topBank.name}` : undefined],
          ["IPO", ipo ? ipo.stage : "—", ipo ? `${formatRaise(ipo.expectedRaiseUsd)} · filed ${formatDateLong(ipo.filedDate)}` : undefined],
        ]}
      />

      {!!profile.deals.length && (
        <SheetSection title="Deal history" className="sheet-wide">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Announced</th>
                <th>Role</th>
                <th>Counterparty</th>
                <th className="r">Value</th>
                <th className="r">Premium</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {profile.deals.slice(0, 12).map(({ deal, role, counterparty }) => (
                <tr key={deal.id}>
                  <td>{formatDateLong(deal.announcedDate)}</td>
                  <td>{role === "Acquirer" ? "Buyer" : "Target"}</td>
                  <td>{counterparty.name}</td>
                  <td className="r">{formatUsd(deal.valueUsd)}</td>
                  <td className="r">{formatPct(deal.premiumPct)}</td>
                  <td>{deal.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {profile.deals.length > 12 && <p className="sheet-note">{profile.deals.length - 12} earlier transactions not shown.</p>}
        </SheetSection>
      )}

      <div className="sheet-grid">
        <SheetSection title="Advisors and underwriters">
          {profile.banks.length ? (
            <SheetRows
              rows={profile.banks.slice(0, 7).map((b) => [
                b.name,
                [b.buySide && `Buy side ×${b.buySide}`, b.sellSide && `Sell side ×${b.sellSide}`, b.ipo && `IPO ×${b.ipo}`].filter(Boolean).join(" · "),
              ])}
            />
          ) : (
            <p className="sheet-empty">No advisors named in Castle&apos;s filings.</p>
          )}
        </SheetSection>
        <SheetSection title="Activist investors">
          {stakes.length ? (
            <SheetRows
              rows={stakes.map((s) => [
                s.investor.name,
                `${s.percent != null ? `${s.percent.toFixed(1)}%` : "—"} · ${formatDateLong(s.filedDate)}${s.aims.length ? ` · ${s.aims.slice(0, 2).join(", ")}` : ""}`,
              ])}
            />
          ) : (
            <p className="sheet-empty">No activist 13D filings since late 2024.</p>
          )}
        </SheetSection>
      </div>
    </TearSheet>
  );
}
