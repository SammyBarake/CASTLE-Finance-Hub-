import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { sectorColor } from "@/lib/sectors";
import type { DealStatus, IpoStage, Sector } from "@/lib/types";
import { AnimatedNumber } from "./AnimatedNumber";
import { ExportButton } from "@/components/export/ExportButton";
import type { LiveLinkSpec } from "@/components/export/LiveLink";
import type { WorkbookSpec } from "@/lib/excel/spec";
import { Icon } from "./Icon";

type CssVars = CSSProperties & Record<`--${string}`, string>;

export function StatusTag({ status }: { status: DealStatus | IpoStage }) {
  return <span className={`status status-${status.toLowerCase()}`}>{status}</span>;
}

export function SectorDot({ sector }: { sector: Sector }) {
  return <span className="dot" style={{ "--color": sectorColor(sector) } as CssVars} />;
}

export function SectorLabel({ sector }: { sector: Sector }) {
  return (
    <span className="sector">
      <SectorDot sector={sector} />
      {sector}
    </span>
  );
}

export const initials = (name: string) => name.replace(/[^A-Z]/g, "").slice(0, 2) || name.slice(0, 2).toUpperCase();

/** Square monogram for a company or bank. */
export function CompanyMark({ name, letters }: { name: string; letters?: string }) {
  return (
    <span className="company-mark" aria-hidden="true">
      {letters ?? initials(name)}
    </span>
  );
}

/** "+26.7%" with a trend arrow, green/red. */
export function Change({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span className={`kpi-change ${up ? "up" : "down"}`}>
      <Icon name={up ? "up-right" : "trend-down"} />
      {up ? "+" : ""}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

export function Kpi({ label, value, note, change, text, title }: { label: string; value: ReactNode; note: ReactNode; change?: ReactNode; text?: boolean; title?: string }) {
  return (
    <div className="kpi" title={title}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-line">
        <span className={`kpi-value num ${text ? "text" : ""}`}>{(typeof value === "string" || typeof value === "number") && !text ? <AnimatedNumber text={String(value)} /> : value}</span>
        {change}
      </div>
      <div className="kpi-note">{note}</div>
    </div>
  );
}

export function Kpis({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="kpis" aria-label={label}>
      {children}
    </section>
  );
}

export function Sparkline({ values, stroke, className = "spark", label, width = 120, height = 30 }: { values: number[]; stroke: string; className?: string; label?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${(2 + (i * (width - 4)) / (values.length - 1)).toFixed(1)},${(height - 2 - ((v - min) / (max - min || 1)) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} stroke={stroke} />
    </svg>
  );
}

export const UP = "#6fba98";
export const DOWN = "#d68187";

export function Segment<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="select-wrap">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilterSearch({ id, label, placeholder, value, onChange }: { id: string; label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="filter-search">
      <Icon name="search" />
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input id={id} placeholder={placeholder} value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function PageLink({ href, children = "View all" }: { href: string; children?: ReactNode }) {
  return (
    <Link className="small-link" href={href}>
      {children}
      <Icon name="right" />
    </Link>
  );
}

/** Page title block with the export button (Excel workbook and / or CSV). */
export function PageHeading({
  title,
  subtitle,
  onExport,
  excel,
  exportLabel,
  extra,
  live,
}: {
  title: string;
  subtitle: string;
  /** The CSV download. */
  onExport?: () => void;
  /** The Excel workbook's contents, built when the menu item is chosen (null: nothing to export). */
  excel?: () => WorkbookSpec | null;
  exportLabel?: string;
  extra?: ReactNode;
  /** The live data link (Export menu → Live link for Excel / Sheets). */
  live?: () => LiveLinkSpec | null;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        <p>{subtitle}</p>
      </div>
      <div className="head-tools">
        {extra}
        {(onExport || excel) && <ExportButton title={title} onCsv={onExport} excel={excel} live={live} label={exportLabel} />}
      </div>
    </div>
  );
}

/** A slim strip of short, number-led findings under a page's KPIs. */
export function Takeaways({ items, label = "Key takeaways" }: { items: string[]; label?: string }) {
  if (!items.length) return null;
  return (
    <section className="takeaways" aria-label={label}>
      <h2>{label}</h2>
      <ul>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

/** Methodology and background, folded away until asked for. */
export function AboutData({ title = "About this data", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="about-data">
      <summary>
        <Icon name="info" />
        {title}
      </summary>
      <div className="about-data-body">{children}</div>
    </details>
  );
}

export function PanelHead({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="panel-head">
      <div className="panel-heading">
        <h2>{title}</h2>
        {subtitle && <small>{subtitle}</small>}
      </div>
      {children}
    </div>
  );
}
