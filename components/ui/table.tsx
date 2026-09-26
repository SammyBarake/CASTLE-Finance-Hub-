import type { KeyboardEvent, ReactNode } from "react";

/** Clickable, keyboard-accessible table row (Enter / Space opens). */
export function RowLink({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <tr className="row-link" tabIndex={0} aria-label={label} onClick={onOpen} onKeyDown={onKeyDown}>
      {children}
    </tr>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="table-empty">
        {children}
      </td>
    </tr>
  );
}
