import type { IconName } from "@/components/ui/Icon";

export type RouteId = "hub" | "deal-flow" | "deal-volume" | "ipo-pipeline" | "advisors" | "valuations" | "world-economies";

export interface RouteDef {
  id: RouteId;
  href: string;
  title: string;
  icon: IconName;
  /** Not built yet: shown in the nav with a "Soon" tag. */
  soon?: boolean;
}

export const ROUTES: RouteDef[] = [
  { id: "hub", href: "/", title: "Hub", icon: "grid" },
  { id: "deal-flow", href: "/deal-flow", title: "Deal Flow", icon: "flow" },
  { id: "deal-volume", href: "/deal-volume", title: "Deal Volume", icon: "chart" },
  { id: "ipo-pipeline", href: "/ipo-pipeline", title: "IPO Pipeline", icon: "ipo" },
  { id: "advisors", href: "/advisors", title: "Advisors", icon: "bank" },
  { id: "valuations", href: "/valuations", title: "Valuations", icon: "values" },
  { id: "world-economies", href: "/world-economies", title: "World Economies", icon: "globe", soon: true },
];

export const routeForPath = (path: string) => ROUTES.find((r) => (r.href === "/" ? path === "/" : path.startsWith(r.href))) ?? ROUTES[0];
