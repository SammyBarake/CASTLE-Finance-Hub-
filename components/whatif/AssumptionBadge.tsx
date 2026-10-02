import { ASSUMPTION } from "@/lib/ripple/links";

/** Marks a result built on hand-set links. Rendered only while the links in use are hand-set. */
export function AssumptionBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="assumption-badge" title={`Hand-set link: ${ASSUMPTION}`}>
      assumption
    </span>
  );
}
