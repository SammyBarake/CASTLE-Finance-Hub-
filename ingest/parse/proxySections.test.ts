import { describe, expect, it } from "vitest";
import { opinionLabel, proxySections } from "./proxySections";

const URL = "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/proxy.htm";

describe("proxySections", () => {
  it("reads the table of contents, the body's link winning over the summary's, the annexes left out", () => {
    const html = `<table>
      <tr><td><a href="#s1">SUMMARY</a></td><td>1</td></tr>
      <tr><td><a href="#s2">Opinion of Goldman Sachs &amp; Co. LLC</a></td><td>8</td></tr>
      <tr><td><a href="#b1">Background of the Merger</a></td><td>30</td></tr>
      <tr><td><a href="#b2">Recommendation of the Board; Reasons for the Merger</a></td><td>41</td></tr>
      <tr><td><a href="#b3">Opinion of Goldman Sachs &amp; Co. LLC</a></td><td>45</td></tr>
      <tr><td>Certain Unaudited Prospective Financial Information</td><td><a href="#b4">52</a></td></tr>
      <tr><td><a href="#b5">Interests of the Company’s Directors and Executive Officers in the Merger</a></td><td>60</td></tr>
      <tr><td><a href="#missing">Appraisal Rights</a></td><td>70</td></tr>
      <tr><td><a href="#b6">Termination Fees</a></td><td>88</td></tr>
      <tr><td><a href="#a1">Annex A – Agreement and Plan of Merger</a></td></tr>
      <tr><td><a href="#a2">Termination Fee.</a></td></tr>
    </table>
    <p id="s1"></p><p id="s2"></p><a name="b1"></a><p id="b2"></p><p id="b3"></p><p id="b4"></p><p id="b5"></p><p id="b6"></p><p id="a1"></p><p id="a2"></p>`;
    expect(proxySections(html, URL).map((s) => `${s.label} #${s.url.split("#")[1]}`)).toEqual([
      "Background #b1",
      "Board's reasons #b2",
      "Opinion of Goldman Sachs #b3",
      "Projections #b4",
      "Insiders' interests #b5",
      "Termination fees #b6",
    ]);
  });

  it("cleans opinion headings", () => {
    expect(opinionLabel("OPINION OF QATALYST PARTNERS LP, SYNAPTICS’ FINANCIAL ADVISOR")).toBe("Opinion of Qatalyst Partners");
    expect(opinionLabel("Opinion of Keefe, Bruyette & Woods, Inc.")).toBe("Opinion of Keefe, Bruyette & Woods");
    expect(opinionLabel("Opinion of Qatalyst Partners LP, dated as of March 9, 2026")).toBe("Opinion of Qatalyst Partners");
  });

  it("gives nothing without a linked table of contents", () => {
    expect(proxySections("<p>Background of the Merger</p>", URL)).toEqual([]);
  });
});
