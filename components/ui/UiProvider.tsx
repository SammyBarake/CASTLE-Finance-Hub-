"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface DialogContent {
  eyebrow: string;
  title: string;
  body: ReactNode;
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

/** App-wide modal dialog and toast. */
export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogContent | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const openDialog = useCallback((content: DialogContent) => setDialog(content), []);
  const closeDialog = useCallback(() => dialogRef.current?.close(), []);
  const toast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 3500);
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (dialog && !el.open) {
      el.showModal();
      document.body.style.overflow = "hidden";
    }
  }, [dialog]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  return (
    <UiContext.Provider value={{ openDialog, closeDialog, toast }}>
      {children}

      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-[25px] left-[calc(50%+104px)] z-[110] max-w-[calc(100%-35px)] -translate-x-1/2 rounded-md border border-[#4d455f] bg-[#22232e] px-[17px] py-[11px] text-[11px] text-[#d4cde3] shadow-[0_12px_35px_#0005] transition-[opacity,transform] duration-200 max-laptop:left-[calc(50%+91px)] max-tablet:left-[calc(50%+85px)] max-phone:bottom-[18px] max-phone:left-1/2 max-phone:text-[10px] ${
          toastVisible ? "translate-y-0 opacity-100" : "translate-y-[15px] opacity-0"
        }`}
      >
        {toastMessage}
      </div>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="modal-title"
        onClose={() => {
          document.body.style.overflow = "";
          setDialog(null);
        }}
        onClick={(e) => {
          // Click on the backdrop (outside the dialog box) closes it.
          if (e.target !== e.currentTarget) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog();
        }}
      >
        {dialog && (
          <>
            <div className="relative border-b border-line px-[25px] pt-6 pb-5">
              <div className="eyebrow">{dialog.eyebrow}</div>
              <h2 id="modal-title" className="mt-2 pr-[25px] text-[21px] leading-[1.4] font-[550] tracking-[-0.5px]">
                {dialog.title}
              </h2>
              <button
                type="button"
                aria-label="Close details"
                onClick={closeDialog}
                className="absolute top-5 right-[19px] flex rounded border border-line p-1 text-[#9997aa] hover:bg-[#252332]"
              >
                <Icon name="close" className="!size-[15px]" />
              </button>
            </div>
            <div className="px-[25px] pt-[21px] pb-6">{dialog.body}</div>
          </>
        )}
      </dialog>
    </UiContext.Provider>
  );
}

/* Building blocks for dialog bodies */

export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="mb-5 grid grid-cols-2 gap-x-[25px]">{children}</div>;
}

export function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-line py-[13px]">
      <div className="mb-1 text-[9px] text-dim">{label}</div>
      <div className="text-[14px] font-medium text-[#dddfe9]">{children}</div>
    </div>
  );
}

export function DetailHeading({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-[10px] font-medium text-[#bdb6ce]">{children}</div>;
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[5px] border border-[#342e42] bg-[#1c1926] p-3 text-[10px] leading-[1.7] text-[#aaa0c3]">
      {children}
    </div>
  );
}
