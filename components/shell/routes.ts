import type { IconName } from "@/components/ui/Icon";

export type RouteId = "hub" | "deal-flow" | "deal-volume" | "ipo-pipeline" | "advisors" | "valuations" | "precedents" | "deal-terms" | "timelines" | "activists" | "world-economies";

export type RouteGroup = "Markets" | "Research" | "Macro";

export interface RouteDef {
  id: RouteId;
  href: string;
  title: string;
  icon: IconName;
  /** Sidebar section. */
  group: RouteGroup;
  /** Not built yet: shown in the nav with a "Soon" tag. */
  soon?: boolean;
}

export const ROUTES: RouteDef[] = [
  { id: "hub", href: "/", title: "Hub", icon: "grid", group: "Markets" },
  { id: "deal-flow", href: "/deal-flow", title: "Deal Flow", icon: "flow", group: "Markets" },
  { id: "deal-volume", href: "/deal-volume", title: "Deal Volume", icon: "chart", group: "Markets" },
  { id: "ipo-pipeline", href: "/ipo-pipeline", title: "IPO Pipeline", icon: "ipo", group: "Markets" },
  { id: "advisors", href: "/advisors", title: "Advisors", icon: "bank", group: "Research" },
  { id: "valuations", href: "/valuations", title: "Valuations", icon: "values", group: "Research" },
  { id: "precedents", href: "/precedents", title: "Precedents", icon: "comps", group: "Research" },
  { id: "deal-terms", href: "/deal-terms", title: "Deal Terms", icon: "shield", group: "Research" },
  { id: "timelines", href: "/timelines", title: "Timelines", icon: "clock", group: "Research" },
  { id: "activists", href: "/activists", title: "Activists", icon: "megaphone", group: "Research" },
  { id: "world-economies", href: "/world-economies", title: "World Economies", icon: "globe", group: "Macro" },
];

/** Company pages sit outside the nav: no sidebar item is highlighted. */
const COMPANY_ROUTE = { id: "company", href: "/company", title: "Company" } as const;

export const routeForPath = (path: string): { id: string; title: string } =>
  path.startsWith("/company/") ? COMPANY_ROUTE : (ROUTES.find((r) => (r.href === "/" ? path === "/" : path.startsWith(r.href))) ?? ROUTES[0]);
