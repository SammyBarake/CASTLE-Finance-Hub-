"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { formatTimestampET } from "@/lib/format";

const noopSubscribe = () => () => {};

export function Topbar({
  query,
  onQueryChange,
  onSubmit,
  asOf,
  isSample,
  menuOpen,
  onToggleMenu,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  /** Enter pressed in the search box. */
  onSubmit: () => void;
  asOf: string;
  isSample: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Server renders "Ctrl K"; Apple devices switch to "⌘ K" after hydration.
  const isApple = useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
  const shortcut = isApple ? "⌘ K" : "Ctrl K";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.querySelector<HTMLDialogElement>("dialog[open]")?.close();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-[65px] items-center justify-between gap-[22px] border-b border-line bg-topbar px-[29px] max-laptop:px-[22px] max-tablet:gap-2.5 max-phone:h-[57px] max-phone:gap-3 max-phone:px-4">
      <button
        type="button"
        className="-ml-[5px] hidden p-1.5 text-[#a7a8b7] max-phone:inline-flex"
        aria-label="Open navigation"
        aria-expanded={menuOpen}
        aria-controls="sidebar"
        onClick={onToggleMenu}
      >
        <Icon name="menu" />
      </button>

      <div className="relative flex w-[390px] max-w-[50%] items-center gap-2.5 text-dim focus-within:text-accent max-tablet:w-[330px] max-tablet:max-w-[60%] max-phone:w-auto max-phone:max-w-full max-phone:flex-1 max-phone:gap-[7px]">
        <Icon name="search" className="!w-[17px]" />
        <label className="sr-only" htmlFor="global-search">
          Search companies, deals, banks
        </label>
        <input
          ref={inputRef}
          id="global-search"
          type="search"
          placeholder="Search companies, deals, banks"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
            if (e.key === "Escape") {
              onQueryChange("");
              e.currentTarget.blur();
            }
          }}
          className="w-full border-0 bg-transparent py-2.5 text-[11px] text-fg !outline-0 placeholder:text-[#858999] max-phone:text-[10px] [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            className="p-0.5 leading-none"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" className="!size-3.5" />
          </button>
        ) : (
          <kbd className="rounded border border-[#2e303a] px-[5px] py-0.5 font-sans text-[9px] leading-[1.5] whitespace-nowrap text-[#9194a3] max-phone:hidden">
            {shortcut}
          </kbd>
        )}
      </div>

      <div className="flex items-center gap-[19px] whitespace-nowrap max-laptop:gap-3 max-phone:gap-0">
        <div className="text-[9px] text-dim max-laptop:text-[8px] max-tablet:hidden">
          Last updated<span className="ml-[5px] text-[#a2a6b3] max-laptop:ml-[3px]">{formatTimestampET(asOf)}</span>
        </div>
        {isSample && (
          <span className="inline-flex items-center gap-1.5 rounded border border-[#373143] bg-[#1a1722] px-2 py-1 text-[9px] text-[#bab3d3] before:size-1 before:rounded-full before:bg-[#aaa0c7] before:content-[''] max-phone:px-1.5 max-phone:py-[3px] max-phone:text-[8px]">
            Sample data
          </span>
        )}
      </div>
    </header>
  );
}
