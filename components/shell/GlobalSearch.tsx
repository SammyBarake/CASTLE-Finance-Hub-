"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { Icon } from "@/components/ui/Icon";
import { CompanyMark } from "@/components/ui/primitives";
import { formatRaise, formatUsd, formatUsdB1 } from "@/lib/format";
import { companyHref, companyId, searchCompanies } from "@/lib/companies";
import { matchAdvisor, matchDeal, matchIpo } from "@/lib/search";

const noopSubscribe = () => () => {};

/** Top-bar search with grouped results (deals, IPOs, advisors). Ctrl/⌘ K focuses it. */
export function GlobalSearch() {
  const { data } = useHubData();
  const { openDeal, openIpo, openAdvisor } = useDetails();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isApple = useSyncExternalStore(noopSubscribe, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    return {
      companies: searchCompanies(data, q, 4),
      deals: data.deals.filter((d) => matchDeal(d, { query: q, sector: "all", status: "all" })).slice(0, 5),
      ipos: data.ipos.filter((i) => matchIpo(i, q)).slice(0, 4),
      advisors: data.leagueTable.entries.map((e, i) => ({ e, rank: i + 1 })).filter(({ e }) => matchAdvisor(e, q)).slice(0, 4),
    };
  }, [q, data]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.querySelector<HTMLDialogElement>("dialog[open]")?.close();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const pick = (go: () => void, href: string) => {
    setOpen(false);
    router.push(href);
    go();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLButtonElement>(".search-result") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[i + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i <= 0) inputRef.current?.focus();
      else items[i - 1]?.focus();
    } else if (e.key === "Enter" && document.activeElement === inputRef.current) {
      e.preventDefault();
      items[0]?.click();
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  const empty = results && !results.companies.length && !results.deals.length && !results.ipos.length && !results.advisors.length;

  return (
    <div className="search" ref={wrapRef} onKeyDown={onKeyDown}>
      <div className="search-field">
        <Icon name="search" />
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
          role="combobox"
          aria-autocomplete="list"
          aria-controls="search-results"
          aria-expanded={open && !!results}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        <kbd>{isApple ? "⌘ K" : "Ctrl K"}</kbd>
      </div>
      {open && results && (
        <div className="search-results" id="search-results" aria-label="Search results">
          {empty && <div className="search-empty">No matching companies, deals, or advisors.</div>}
          {!!results.companies.length && <div className="search-group">Companies</div>}
          {results.companies.map(({ company, count }) => (
            <button key={companyId(company)} type="button" className="search-result" onClick={() => pick(() => {}, companyHref(company))}>
              <CompanyMark name={company.name} />
              <span className="search-result-label">
                {company.name}
                <small>
                  {company.ticker ? `${company.ticker} · ` : ""}
                  {count} record{count === 1 ? "" : "s"}
                </small>
              </span>
              <Icon name="right" />
            </button>
          ))}
          {!!results.deals.length && <div className="search-group">Deals</div>}
          {results.deals.map((d) => (
            <button key={d.id} type="button" className="search-result" onClick={() => pick(() => openDeal(d), "/deal-flow")}>
              <CompanyMark name={d.target.name} />
              <span className="search-result-label">
                {d.target.name}
                <small>{d.acquirer.name}</small>
              </span>
              <span className="search-result-value">{formatUsd(d.valueUsd)}</span>
            </button>
          ))}
          {!!results.ipos.length && <div className="search-group">IPO pipeline</div>}
          {results.ipos.map((i) => (
            <button key={i.id} type="button" className="search-result" onClick={() => pick(() => openIpo(i), "/ipo-pipeline")}>
              <CompanyMark name={i.company.name} />
              <span className="search-result-label">
                {i.company.name}
                <small>
                  {i.company.ticker ? `${i.company.ticker} · ` : ""}
                  {i.stage}
                </small>
              </span>
              <span className="search-result-value">{formatRaise(i.expectedRaiseUsd)}</span>
            </button>
          ))}
          {!!results.advisors.length && <div className="search-group">Advisors</div>}
          {results.advisors.map(({ e, rank }) => (
            <button key={e.advisor.name} type="button" className="search-result" onClick={() => pick(() => openAdvisor(e, rank), "/advisors")}>
              <CompanyMark name={e.advisor.name} letters={e.advisor.shortName} />
              <span className="search-result-label">
                {e.advisor.name}
                <small>{e.dealCount} deals advised</small>
              </span>
              <span className="search-result-value">{formatUsdB1(e.dealValueUsd)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
