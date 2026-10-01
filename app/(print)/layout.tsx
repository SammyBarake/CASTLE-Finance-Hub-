import type { ReactNode } from "react";

/** Printable pages (tear sheets): no terminal shell, just a stage around the paper. */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <main className="sheet-stage">{children}</main>;
}
