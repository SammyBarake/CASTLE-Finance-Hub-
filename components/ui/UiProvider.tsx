"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface DialogContent {
  eyebrow: string;
  title: string;
  body: ReactNode;
  /** "drawer" slides in from the right (record details); "modal" is centred; "wide" is a large centred modal. */
  variant?: "modal" | "drawer" | "wide";
}

export type MenuItem =
  | { kind: "title"; label: string }
  | { kind: "rule" }
  | { kind: "action"; label: string; icon?: IconName; shortcut?: string; onSelect: () => void }
  | { kind: "check"; label: string; checked: boolean; disabled?: boolean; onToggle: (checked: boolean) => void };

/** Where to open a menu: at the pointer (right-click) or under an anchor element (button). */
export type MenuPosition = { x: number; y: number } | { anchor: HTMLElement };

interface UiContextValue {
  openDialog: (content: DialogContent) => void;
  closeDialog: () => void;
  toast: (message: string) => void;
  openMenu: (items: MenuItem[], at: MenuPosition) => void;
  closeMenu: () => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside <UiProvider>");
  return ctx;
}

/** App-wide dialog / side drawer and toast. */
export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogContent | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [menu, setMenu] = useState<{ items: MenuItem[]; at: MenuPosition; refresh?: boolean } | null>(null);
  /** Where the menu sits, the point it scales out from, and whether it opened above its anchor (no room below). */
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; origin: string; above: boolean } | null>(null);
  const [menuClosing, setMenuClosing] = useState(false);
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);

  const dialogStateRef = useRef<DialogContent | null>(null);
  const menuStateRef = useRef<{ at: MenuPosition } | null>(null);

  const openDialog = useCallback((content: DialogContent) => {
    const el = dialogRef.current;
    if (!el?.open) originRef.current = document.activeElement as HTMLElement | null;
    const current = dialogStateRef.current;
    // Switching between a centred modal and the side drawer: close, then reopen so it animates from the right place.
    if (el?.open && current && (current.variant ?? "modal") !== (content.variant ?? "modal")) {
      el.close();
      requestAnimationFrame(() => {
        if (!el.open) {
          el.showModal();
          document.body.style.overflow = "hidden";
        }
      });
    }
    dialogStateRef.current = content;
    menuStateRef.current = null;
    clearTimeout(menuCloseTimer.current);
    setMenuClosing(false);
    setMenu(null);
    setDialog(content);
  }, []);
  const closeDialog = useCallback(() => dialogRef.current?.close(), []);
  const toast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 3000);
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (el && dialog && !el.open) {
      el.showModal();
      document.body.style.overflow = "hidden";
    }
    if (el && dialog) el.scrollTop = 0;
  }, [dialog]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ---- context menu ----
  const openMenu = useCallback((items: MenuItem[], at: MenuPosition) => {
    // Re-opening from the same anchor (e.g. ticking a Columns checkbox) updates the items in place:
    // no re-positioning, no replayed animation, focus stays where it is.
    const current = menuStateRef.current;
    const sameAnchor = !!current && "anchor" in current.at && "anchor" in at && current.at.anchor === at.anchor;
    if (!sameAnchor) setMenuPos(null);
    clearTimeout(menuCloseTimer.current);
    setMenuClosing(false);
    menuStateRef.current = { at };
    setMenu({ items, at, refresh: sameAnchor });
  }, []);
  // A short fade-out before the menu goes; keyboard focus goes back to the button that opened it.
  const closeMenu = useCallback(() => {
    const current = menuStateRef.current;
    if (!current) return;
    if ("anchor" in current.at && menuRef.current?.contains(document.activeElement)) current.at.anchor.focus({ preventScroll: true });
    menuStateRef.current = null;
    setMenuClosing(true);
    clearTimeout(menuCloseTimer.current);
    menuCloseTimer.current = setTimeout(() => {
      setMenu(null);
      setMenuClosing(false);
    }, 110);
  }, []);
  useEffect(() => () => clearTimeout(menuCloseTimer.current), []);

  // Place the menu once it has a size, keeping it inside the viewport.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el || menu.refresh) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
    // Below the anchor (or the pointer) when it fits; above it when it doesn't and there's room there.
    let x: number, y: number, above = false;
    if ("anchor" in menu.at) {
      const r = menu.at.anchor.getBoundingClientRect();
      x = r.right - w;
      y = r.bottom + 6;
      if (y + h > innerHeight - 12 && r.top - h - 6 >= 12) {
        y = r.top - h - 6;
        above = true;
      }
    } else {
      x = menu.at.x;
      y = menu.at.y;
      if (y + h > innerHeight - 12 && y - h >= 12) {
        y -= h;
        above = true;
      }
    }
    const left = clamp(x, 12, innerWidth - w - 12);
    const top = clamp(y, 12, innerHeight - h - 12);
    // Scale out from the anchor's middle edge, or from the pointer.
    let origin: string;
    if ("anchor" in menu.at) {
      const r = menu.at.anchor.getBoundingClientRect();
      origin = `${clamp(r.left + r.width / 2 - left, 0, w)}px ${above ? h : 0}px`;
    } else {
      origin = `${clamp(menu.at.x - left, 0, w)}px ${clamp(menu.at.y - top, 0, h)}px`;
    }
    setMenuPos({ left, top, origin, above });
    el.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if ("anchor" in menu.at && menu.at.anchor.contains(e.target as Node)) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("button, input") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    };
    const close = () => closeMenu();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, closeMenu]);

  return (
    <UiContext.Provider value={{ openDialog, closeDialog, toast, openMenu, closeMenu }}>
      {children}

      {menu && (
        <div
          ref={menuRef}
          className={`context-menu${menuPos?.above ? " above" : ""}${menuClosing ? " closing" : ""}`}
          role="menu"
          style={{ left: menuPos?.left ?? -9999, top: menuPos?.top ?? -9999, maxHeight: "calc(100vh - 24px)", transformOrigin: menuPos?.origin }}
        >
          {menu.items.map((item, i) => {
            // `--i` staggers the items' entrance.
            const stagger = { "--i": i } as CSSProperties;
            if (item.kind === "title") return <div key={i} className="menu-title" style={stagger}>{item.label}</div>;
            if (item.kind === "rule") return <div key={i} className="menu-rule" style={stagger} />;
            if (item.kind === "check")
              return (
                <label key={i} role="menuitemcheckbox" aria-checked={item.checked} style={stagger}>
                  <input type="checkbox" checked={item.checked} disabled={item.disabled} onChange={(e) => item.onToggle(e.target.checked)} />
                  <span>{item.label}</span>
                </label>
              );
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                style={stagger}
                onClick={() => {
                  closeMenu();
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} className={item.icon === "star" && item.label.startsWith("Remove") ? "star-fill" : ""} />}
                {item.label}
                {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className={`toast ${toastVisible ? "show" : ""}`} role="status" aria-live="polite">
        {toastMessage}
      </div>

      <dialog
        ref={dialogRef}
        className={`modal ${dialog?.variant === "drawer" ? "detail-drawer" : dialog?.variant === "wide" ? "compare-dialog" : ""}`}
        aria-labelledby="modal-title"
        onClose={() => {
          document.body.style.overflow = "";
          if (originRef.current?.isConnected) originRef.current.focus({ preventScroll: true });
          // Keep the content while the exit transition plays; drop it only if nothing reopened meanwhile.
          setTimeout(() => setDialog((d) => (dialogRef.current?.open ? d : null)), 280);
        }}
        onClick={(e) => {
          // Clicking the backdrop (outside the box) closes it.
          if (e.target !== e.currentTarget) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog();
        }}
      >
        {dialog && (
          <>
            <div className="modal-header">
              <div className="modal-eyebrow">{dialog.eyebrow}</div>
              <h2 id="modal-title">{dialog.title}</h2>
              <button type="button" className="modal-close" aria-label="Close details" onClick={closeDialog}>
                <Icon name="close" />
              </button>
            </div>
            <div className="modal-body">{dialog.body}</div>
          </>
        )}
      </dialog>
    </UiContext.Provider>
  );
}

/* Building blocks for dialog bodies */

export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="modal-grid">{children}</div>;
}

export function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{children}</div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="modal-note">{children}</div>;
}
