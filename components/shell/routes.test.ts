import { describe, expect, it } from "vitest";
import { routeForPath, SECTIONS } from "./routes";

describe("routes", () => {
  it("matches the longest page path, so a sub-page isn't taken for its parent", () => {
    expect(routeForPath("/what-if").id).toBe("what-if");
    expect(routeForPath("/what-if/accuracy").id).toBe("what-if-accuracy");
    expect(routeForPath("/hub").id).toBe("hub");
    expect(routeForPath("/deal-flow").id).toBe("deal-flow");
    expect(routeForPath("/company/0000320193").id).toBe("company");
  });

  it("keeps the footer's info pages out of the nav", () => {
    for (const path of ["/about", "/terms", "/privacy"]) expect(routeForPath(path).section, path).toBeNull();
    expect(routeForPath("/about").title).toBe("About Castle");
  });

  it("gives What-if its own section with two tabs", () => {
    const whatIf = SECTIONS.find((s) => s.id === "whatif")!;
    expect(whatIf.routes.map((r) => r.tab)).toEqual(["Scenarios", "Accuracy"]);
    expect(SECTIONS).toHaveLength(7);
  });
});
