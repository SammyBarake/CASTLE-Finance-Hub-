import type { CSSProperties, ReactNode } from "react";
import { sectorColor } from "@/lib/sectors";
import type { DealStatus, IpoStage, Sector } from "@/lib/types";
import { Icon } from "./Icon";

type SectorStyle = CSSProperties & Record<`--${string}`, string>;

export function StatusTag({ status }: { status: DealStatus | IpoStage }) {
  return <span className={`status status-${status.toLowerCase()}`}>{status}</span>;
}

export function SectorDot({ sector }: { sector: Sector }) {
  return <span className="sector-dot" style={{ "--sector-color": sectorColor(sector) } as SectorStyle} />;
}

export function SectorLabel({ sector }: { sector: Sector }) {
  return (
    <span className="flex items-center gap-1.5 text-[9px]">
      <SectorDot sector={sector} />
      {sector}
    </span>
  );
}

/** Two-letter monogram tinted with the sector colour. */
export function CompanyIcon({ name, sector }: { name: string; sector: Sector }) {
  const color = sectorColor(sector);
  const initials = name.replace(/[^A-Z]/g, "").slice(0, 2) || name.slice(0, 2).toUpperCase();
  return (
    <span
      className="inline-grid size-[23px] shrink-0 place-items-center rounded-[5px] border border-white/[0.04] text-[8px] font-[650]"
      style={{ background: `${color}12`, color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/** Up/down change with a trend arrow, coloured green/red. */
export function Delta({ value, children, className = "" }: { value: number; children: ReactNode; className?: string }) {
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-[3px] ${up ? "text-up" : "text-down"} ${className}`}>
      <Icon name={up ? "trend-up" : "trend-down"} className="!size-[11px]" />
      {children}
    </span>
  );
}

export function Sparkline({
  values,
  width,
  height,
  stroke,
  strokeWidth = 1.6,
  className,
  label,
}: {
  values: number[];
  width: number;
  height: number;
  stroke: string;
  strokeWidth?: number;
  className?: string;
  label?: string;
}) {
  if (values.length < 2) return null;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const d = values
    .map((v, i) => {
      const x = pad + (i * (width - 2 * pad)) / (values.length - 1);
      const y = height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const UP_COLOR = "#6dc7a1";
export const DOWN_COLOR = "#e39199";

/** Panel title block: heading, tag, subtitle. */
export function PanelTitle({ id, title, tag, subtitle }: { id: string; title: string; tag?: ReactNode; subtitle: string }) {
  return (
    <div>
      <div className="flex items-center gap-[9px]">
        <h2 id={id} className="text-[13px] font-[550] tracking-[-0.1px] max-phone:text-[12px]">
          {title}
        </h2>
        {tag != null && <span className="tiny-tag">{tag}</span>}
      </div>
      <div className="mt-1 text-[10px] text-dim max-phone:text-[9px]">{subtitle}</div>
    </div>
  );
}

export function Segment<T extends string | number>({
  label,
  options,
  value,
  onChange,
  accent,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accent?: boolean;
}) {
  return (
    <div className={`segment ${accent ? "segment-accent" : ""}`} role="group" aria-label={label}>
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
    <div className="relative after:pointer-events-none after:absolute after:right-2.5 after:top-[11px] after:size-1 after:rotate-45 after:border-r after:border-b after:border-[#979aac]">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="select max-phone:pl-[7px] max-phone:pr-[22px] max-phone:text-[8px]" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
