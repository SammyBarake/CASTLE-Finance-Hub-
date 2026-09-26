"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface DialogContent {
  eyebrow: string;
  title: string;
  body: ReactNode;
  /** "drawer" slides in from the right (record details); "modal" is centred (reference, forms). */
  variant?: "modal" | "drawer";
}

interface UiContextValue {
  openDialog: (content: DialogContent) => void;
  closeDialog: () => void;
  toast: (message: string) => void;
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

  const openDialog = useCallback((content: DialogContent) => {
    if (!dialogRef.current?.open) originRef.current = document.activeElement as HTMLElement | null;
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

  return (
    <UiContext.Provider value={{ openDialog, closeDialog, toast }}>
      {children}

      <div className={`toast ${toastVisible ? "show" : ""}`} role="status" aria-live="polite">
        {toastMessage}
      </div>

      <dialog
        ref={dialogRef}
        className={`modal ${dialog?.variant === "drawer" ? "detail-drawer" : ""}`}
        aria-labelledby="modal-title"
        onClose={() => {
          document.body.style.overflow = "";
          setDialog(null);
          if (originRef.current?.isConnected) originRef.current.focus({ preventScroll: true });
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
