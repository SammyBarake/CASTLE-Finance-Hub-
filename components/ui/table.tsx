import type { KeyboardEvent, ReactNode } from "react";
import type { MenuPosition } from "./UiProvider";

/** Clickable, keyboard-accessible table row (Enter / Space opens; right-click opens `onMenu`). */
export function RowLink({ label, onOpen, onMenu, className = "", children }: { label: string; onOpen: () => void; onMenu?: (at: MenuPosition) => void; className?: string; children: ReactNode }) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // let buttons inside the row handle their own keys
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <tr
      className={`row-link ${className}`}
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu({ x: e.clientX, y: e.clientY });
            }
          : undefined
      }
    >
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
