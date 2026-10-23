import type { IconName } from "@/components/ui/Icon";

export type RouteId =
  | "hub"
  | "coverage"
  | "deal-flow"
  | "deal-volume"
  | "ipo-pipeline"
  | "advisors"
  | "valuations"
  | "precedents"
  | "books"
  | "what-if"
  | "what-if-accuracy"
  | "deal-terms"
  | "timelines"
  | "activists"
  | "world-economies";
export type SectionId = "hub" | "ma" | "valuation" | "advisors" | "ipos" | "macro" | "whatif";

export interface RouteDef {
  id: RouteId;
  href: string;
  /** Page name (breadcrumb, page title). */
  title: string;
  /** Short label on the section's tab bar. */
  tab: string;
  section: SectionId;
}

export interface SectionDef {
  id: SectionId;
  title: string;
  icon: IconName;
  /** Pages in this section, in tab order; the first is where the sidebar link goes. */
  routes: RouteDef[];
}

export const ROUTES: RouteDef[] = [
  { id: "hub", href: "/", title: "Hub", tab: "Hub", section: "hub" },
  { id: "coverage", href: "/coverage", title: "Data Coverage", tab: "Coverage", section: "hub" },
  { id: "deal-flow", href: "/deal-flow", title: "Deal Flow", tab: "Deal Flow", section: "ma" },
  { id: "deal-volume", href: "/deal-volume", title: "Deal Volume", tab: "Volume", section: "ma" },
  { id: "deal-terms", href: "/deal-terms", title: "Deal Terms", tab: "Deal Terms", section: "ma" },
  { id: "timelines", href: "/timelines", title: "Timelines", tab: "Timelines", section: "ma" },
  { id: "activists", href: "/activists", title: "Activists", tab: "Activism", section: "ma" },
  { id: "valuations", href: "/valuations", title: "Valuations", tab: "Multiples", section: "valuation" },
  { id: "precedents", href: "/precedents", title: "Precedents", tab: "Precedents", section: "valuation" },
  { id: "books", href: "/books", title: "Deal Books", tab: "Deal Books", section: "valuation" },
  { id: "advisors", href: "/advisors", title: "Advisors", tab: "Advisors", section: "advisors" },
  { id: "ipo-pipeline", href: "/ipo-pipeline", title: "IPO Pipeline", tab: "IPO Pipeline", section: "ipos" },
  { id: "world-economies", href: "/world-economies", title: "World Economies", tab: "World Economies", section: "macro" },
  { id: "what-if", href: "/what-if", title: "Scenarios", tab: "Scenarios", section: "whatif" },
  { id: "what-if-accuracy", href: "/what-if/accuracy", title: "Accuracy", tab: "Accuracy", section: "whatif" },
];

const META: { id: SectionId; title: string; icon: IconName }[] = [
  { id: "hub", title: "Hub", icon: "grid" },
  { id: "ma", title: "M&A", icon: "flow" },
  { id: "valuation", title: "Valuation", icon: "values" },
  { id: "advisors", title: "Advisors", icon: "bank" },
  { id: "ipos", title: "IPOs", icon: "ipo" },
  { id: "macro", title: "Macro", icon: "globe" },
  { id: "whatif", title: "What-if", icon: "ripple" },
];

/** The sidebar: seven sections, each holding one or more pages shown as tabs. */
export const SECTIONS: SectionDef[] = META.map((s) => ({ ...s, routes: ROUTES.filter((r) => r.section === s.id) }));

/** Company pages sit outside the nav: no sidebar item is highlighted. */
const COMPANY_ROUTE = { id: "company", href: "/company", title: "Company", tab: "Company", section: null } as const;

/** A shared deal book (/book/<link id>): outside the nav, like company pages, so a visitor from a link sees no tabs. */
const SHARED_BOOK_ROUTE = { id: "book", href: "/book", title: "Deal Book", tab: "Deal Book", section: null } as const;

/** Site pages linked from the footer (about, terms, privacy): outside the nav, like company pages. */
export const INFO_ROUTES = [
  { id: "about", href: "/about", title: "About Castle", tab: "About", section: null },
  { id: "terms", href: "/terms", title: "Terms of Use", tab: "Terms", section: null },
  { id: "privacy", href: "/privacy", title: "Privacy", tab: "Privacy", section: null },
] as const;

/**
 * Pages drawn entirely from the boot copy (aggregates, the newest few deals and IPOs, the Hub's headline figures:
 * `bootHubData`): they show with the server's HTML instead of waiting for /api/hub, which on a phone is the
 * difference between content at ~2 s and at ~6 s. A page that lists or counts deals, IPOs, stakes or fees must not
 * be here (it would show empty, then jump).
 */
export const BOOT_READY: ReadonlySet<string> = new Set(["hub", "deal-volume", "advisors", "world-economies", "what-if-accuracy", "terms", "privacy"]);

/**
 * Pages that are mostly the dataset's details (lib/wire.ts: deal protections, filing milestones, buyer reactions,
 * the banks' DCFs, activist stakes, fees): they wait for the second download as well. Pages with only a section of
 * details show it loading instead (Valuations' "Did buyers win?", Precedents' DCFs, Advisors' fees).
 */
export const NEEDS_DETAILS: ReadonlySet<string> = new Set(["deal-terms", "timelines", "activists", "coverage", "company"]);

/** The page for a path: the longest matching href wins, so "/what-if/accuracy" isn't taken for "/what-if". */
export const routeForPath = (path: string): { id: string; title: string; section: SectionId | null } =>
  path.startsWith("/company/")
    ? COMPANY_ROUTE
    : path.startsWith("/book/")
      ? SHARED_BOOK_ROUTE
      : (INFO_ROUTES.find((r) => path === r.href) ??
      ROUTES.filter((r) => (r.href === "/" ? path === "/" : path === r.href || path.startsWith(`${r.href}/`))).sort((a, b) => b.href.length - a.href.length)[0] ??
      ROUTES[0]);

export const sectionOf = (id: SectionId | null) => SECTIONS.find((s) => s.id === id) ?? null;
