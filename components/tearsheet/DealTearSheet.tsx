import { buyerType } from "@/lib/buyers";
import { considerationLabel, formatDateLong, formatMultiple, formatPct, formatPrice, formatUsd } from "@/lib/format";
import { median } from "@/lib/metrics";
import { feeLabel, feeUsd, financingLabel, goShopLabel, termsRows } from "@/lib/terms";
import type { Deal, HubData } from "@/lib/types";
import { SheetFigures, SheetRows, SheetSection, TearSheet } from "./TearSheet";

const pctOf = (fee: number | null | undefined, value: number | null) => (fee != null && value ? (fee / value) * 100 : null);
const withTicker = (c: { name: string; ticker: string | null }) => (c.ticker ? `${c.name} (${c.ticker})` : c.name);

/** Same-sector public deals in the 24 months before this one: the yardstick for its premium, multiple and fee. */
function sectorContext(deal: Deal, data: HubData) {
  const end = Date.parse(deal.announcedDate);
  const peers = data.deals.filter(
    (d) => d.id !== deal.id && d.sector === deal.sector && !d.privateTarget && d.status !== "Terminated" && Date.parse(d.announcedDate) <= end && end - Date.parse(d.announcedDate) <= 730 * 86_400_000,
  );
  const vals = (f: (d: Deal) => number | null) => peers.map(f).filter((v): v is number => v != null);
  const fees = termsRows(peers)
    .map((r) => r.targetFeePct)
    .filter((v): v is number => v != null);
  return { n: peers.length, premium: median(vals((d) => d.premiumPct)), evEbitda: median(vals((d) => d.evEbitda)), breakFee: median(fees) };
}

function Timeline({ deal }: { deal: Deal }) {
  const m = deal.milestones;
  const steps: { label: string; date: string | null; tone?: "bad" }[] = [{ label: "Announced", date: deal.announcedDate }];
  if (m?.firstFiling) steps.push({ label: m.path === "tender" ? "Tender offer" : m.firstFiling.form.startsWith("S-4") ? "S-4 filed" : "Proxy filed", date: m.firstFiling.date });
  if (m?.path === "vote") steps.push({ label: "Definitive proxy", date: m.definitiveProxy });
  if (m?.path === "vote") steps.push({ label: "Shareholder vote", date: m.voteHeld ?? null });
  if (deal.status === "Terminated") steps.push({ label: "Terminated", date: m?.terminated ?? deal.statusDate, tone: "bad" });
  else steps.push({ label: "Closed", date: m?.closed ?? (deal.status === "Closed" ? deal.statusDate : null) });
  return (
    <ol className="sheet-timeline">
      {steps.map((s, i) => (
        <li key={s.label + i} className={`${s.date ? "done" : ""} ${s.tone ?? ""}`}>
          <i />
          <span>{s.label}</span>
          <b>{s.date ? formatDateLong(s.date) : deal.status === "Terminated" || deal.status === "Closed" ? "—" : "Pending"}</b>
        </li>
      ))}
    </ol>
  );
}

/** Implied value per share by analysis, from the target board's fairness opinions, against the offer price. */
function FootballField({ deal }: { deal: Deal }) {
  const opinions = (deal.fairness ?? []).filter((o) => o.ranges.length).slice(0, 2);
  const rows = opinions.flatMap((o) => o.ranges.slice(0, 5).map((r) => ({ bank: o.bank, ...r })));
  if (!rows.length) return null;
  const offer = deal.pricePerShare;
  const lo = Math.min(...rows.map((r) => r.low), offer ?? Infinity);
  const hi = Math.max(...rows.map((r) => r.high), offer ?? -Infinity);
  const pad = (hi - lo) * 0.08 || 1;
  const x = (v: number) => ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 100;
  return (
    <SheetSection title="Valuation · fairness opinions" className="sheet-wide">
      <div className="sheet-ff">
        {rows.map((r, i) => (
          <div key={i} className="sheet-ff-row">
            <span className="sheet-ff-label">
              {r.method}
              {opinions.length > 1 && <small>{r.bank}</small>}
            </span>
            <span className="sheet-ff-track">
              <i style={{ left: `${x(r.low)}%`, width: `${Math.max(0.8, x(r.high) - x(r.low))}%` }}>
                <em className="lo">${r.low.toFixed(2)}</em>
                <em className="hi">${r.high.toFixed(2)}</em>
              </i>
              {offer != null && <span className="sheet-ff-offer" style={{ left: `${x(offer)}%` }} />}
            </span>
          </div>
        ))}
        {offer != null && (
          <div className="sheet-ff-row sheet-ff-axis">
            <span />
            <span className="sheet-ff-track">
              <span className="sheet-ff-offer-label" style={{ left: `${x(offer)}%` }}>
                Offer {formatPrice(offer)}
              </span>
            </span>
          </div>
        )}
      </div>
      <p className="sheet-note">
        Implied value per {deal.target.name} share by analysis{opinions[0]?.bank ? `, from ${opinions.map((o) => o.bank).filter(Boolean).join(" and ")}` : ""}
        {opinions[0]?.discountRatePct ? ` · DCF discount rate ${opinions[0].discountRatePct[0]}%–${opinions[0].discountRatePct[1]}%` : ""}.
      </p>
    </SheetSection>
  );
}

export function DealTearSheet({ deal, data }: { deal: Deal; data: HubData }) {
  const t = deal.terms;
  const ctx = deal.privateTarget ? null : sectorContext(deal, data);
  const statusLine = deal.statusDate && deal.status !== "Announced" ? `${deal.status} ${formatDateLong(deal.statusDate)}` : deal.status;
  const vs = (v: number | null, m: number | null, fmt: (x: number) => string) => (v != null && m != null ? `${fmt(v)} vs. ${fmt(m)} sector median` : m != null ? `Sector median ${fmt(m)}` : "—");

  return (
    <TearSheet
      kind="Transaction tear sheet"
      asOf={data.asOf}
      sources={
        <ul>
          {deal.filings.slice(0, 6).map((f) => (
            <li key={f.url}>
              {f.form} · {formatDateLong(f.filedDate)}
            </li>
          ))}
        </ul>
      }
    >
      <div className="sheet-title">
        <span className="sheet-eyebrow">
          M&amp;A · {deal.sector}
          {deal.industry ? ` · ${deal.industry}` : ""}
        </span>
        <h1>
          {deal.acquirer.name} <span>to acquire</span> {deal.target.name}
        </h1>
        <p>
          Announced {formatDateLong(deal.announcedDate)} · {statusLine}
          {deal.privateTarget ? " · Private target" : ""}
        </p>
      </div>

      <SheetFigures
        items={[
          ["Deal value", formatUsd(deal.valueUsd), deal.enterpriseValueUsd ? `EV ${formatUsd(deal.enterpriseValueUsd)}` : undefined],
          ["Premium", formatPct(deal.premiumPct), "To unaffected price"],
          ["EV / EBITDA", formatMultiple(deal.evEbitda), deal.evRevenue != null ? `${formatMultiple(deal.evRevenue)} EV / Revenue` : undefined],
          ["Consideration", considerationLabel(deal.consideration), deal.pricePerShare != null ? `${formatPrice(deal.pricePerShare)} per share` : undefined],
        ]}
      />

      <div className="sheet-grid">
        <SheetSection title="Transaction">
          <SheetRows
            rows={[
              ["Acquirer", withTicker(deal.acquirer)],
              ["Target", withTicker(deal.target)],
              ["Buyer type", buyerType(deal)],
              ["Offer price per share", formatPrice(deal.pricePerShare)],
              ["Enterprise value", formatUsd(deal.enterpriseValueUsd)],
              ["Status", statusLine],
            ]}
          />
        </SheetSection>
        <SheetSection title="Deal protections">
          {t ? (
            <SheetRows
              rows={[
                ["Break fee (target pays)", feeLabel(t.targetFeeUsd, pctOf(t.targetFeeUsd, deal.valueUsd), feeUsd)],
                ["Reverse fee (buyer pays)", feeLabel(t.reverseFeeUsd, pctOf(t.reverseFeeUsd, deal.valueUsd), feeUsd)],
                ["Go-shop", goShopLabel(t)],
                ["Financing", financingLabel(t, 6)],
              ]}
            />
          ) : (
            <p className="sheet-empty">{deal.privateTarget ? "Not disclosed for private-company acquisitions." : "Not yet read from the merger agreement."}</p>
          )}
        </SheetSection>
      </div>

      <div className="sheet-grid">
        <SheetSection title="Advisors">
          <SheetRows
            rows={[
              ["To the acquirer", deal.acquirerAdvisors.length ? deal.acquirerAdvisors.join(", ") : "Not disclosed"],
              ["To the target", deal.targetAdvisors.length ? deal.targetAdvisors.join(", ") : "Not disclosed"],
              ...((deal.fairness ?? []).filter((o) => o.feeUsd && o.bank).slice(0, 2).map((o) => [`${o.bank} fee`, feeUsd(o.feeUsd)] as [string, string])),
            ]}
          />
        </SheetSection>
        {ctx && ctx.n >= 3 ? (
          <SheetSection title={`Sector context · ${deal.sector}`}>
            <SheetRows
              rows={[
                ["Comparable deals", `${ctx.n} in the prior 24 months`],
                ["Premium", vs(deal.premiumPct, ctx.premium, (v) => `${v.toFixed(0)}%`)],
                ["EV / EBITDA", vs(deal.evEbitda, ctx.evEbitda, (v) => `${v.toFixed(1)}x`)],
                ["Break fee", vs(pctOf(t?.targetFeeUsd, deal.valueUsd), ctx.breakFee, (v) => `${v.toFixed(1)}%`)],
              ]}
            />
          </SheetSection>
        ) : (
          <SheetSection title="Classification">
            <SheetRows
              rows={[
                ["Sector", deal.sector],
                ["Industry", deal.industry ?? "—"],
              ]}
            />
          </SheetSection>
        )}
      </div>

      {!deal.privateTarget && (
        <SheetSection title="Timeline" className="sheet-wide">
          <Timeline deal={deal} />
        </SheetSection>
      )}

      <FootballField deal={deal} />
    </TearSheet>
  );
}
