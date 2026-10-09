import type { ReactNode } from "react";
import { formatDateLong } from "@/lib/format";

/** A printable Letter-size page: logo header, content, sources and disclaimer footer. */
export function TearSheet({ kind, asOf, children, sources }: { kind: string; asOf: string; children: ReactNode; sources: ReactNode }) {
  return (
    <article className="sheet" aria-label={`${kind} tear sheet`}>
      <header className="sheet-head">
        {/* The cream logo is drawn dark on paper (CSS filter), keeping its transparent background. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sheet-logo" src="/castle-logo.png" alt="Castle" width={64} height={49} />
        <div className="sheet-head-meta">
          <span className="sheet-kind">{kind}</span>
          <span>Data as of {formatDateLong(asOf.slice(0, 10))}</span>
        </div>
      </header>
      {children}
      <footer className="sheet-foot">
        <div className="sheet-sources">
          <span className="sheet-label">Sources</span>
          {sources}
        </div>
        <p>Prepared with Castle from public SEC EDGAR filings. Figures are extracted automatically; verify against the source documents. Not investment advice.</p>
      </footer>
    </article>
  );
}

export function SheetSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`sheet-section ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Label / value rows. */
export function SheetRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="sheet-rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The headline figures strip. */
export function SheetFigures({ items }: { items: [string, ReactNode, ReactNode?][] }) {
  return (
    <div className="sheet-figures">
      {items.map(([label, value, note]) => (
        <div key={label}>
          <span>{label}</span>
          <b>{value}</b>
          {note && <small>{note}</small>}
        </div>
      ))}
    </div>
  );
}
