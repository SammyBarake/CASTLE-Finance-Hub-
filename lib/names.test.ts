import { describe, expect, it } from "vitest";
import { displayCompanyName, titleCaseCaps } from "./names";

describe("displayCompanyName", () => {
  it.each([
    ["Lifecore Biomedical, Inc. \\Del\\", "Lifecore Biomedical, Inc."],
    ["Acme Corp /DE/", "Acme Corp"],
    ["PERDOCEO EDUCATION Corp", "Perdoceo Education Corp"],
    ["TransDigm Group INC", "TransDigm Group Inc"],
    ["CANADIAN PACIFIC", "Canadian Pacific"],
    ["NVIDIA Corp", "NVIDIA Corp"],
    ["BIO-TECHNE Corp", "BIO-TECHNE Corp"],
    ["AT&T Inc.", "AT&T Inc."],
    ["IBM", "IBM"],
    ["Hormel Foods Corp", "Hormel Foods Corp"],
  ])("%s -> %s", (raw, shown) => expect(displayCompanyName(raw)).toBe(shown));
});

describe("titleCaseCaps", () => {
  it("handles small words and acronyms", () => {
    expect(titleCaseCaps("THE CONFIDANTE MIAMI BEACH")).toBe("The Confidante Miami Beach");
    expect(titleCaseCaps("TRINITY AIR MEDICAL")).toBe("Trinity Air Medical");
    expect(titleCaseCaps("C&K SWITCHES")).toBe("C&K Switches");
  });
});
