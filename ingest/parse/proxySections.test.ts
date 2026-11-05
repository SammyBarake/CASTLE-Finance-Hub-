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

  const toc = (rows: [string, string][]) => `<table>${rows.map(([id, h]) => `<tr><td><a href="#${id}">${h}</a></td></tr>`).join("")}</table>`;
  const links = (html: string) => proxySections(html, URL).map((s) => `${s.label} #${s.url.split("#")[1]}`);

  it("skips a link that lands in the annexed agreement, with no annex row in the contents", () => {
    // Proofpoint: Financing landed on "Section 4.4 Financing", Termination fees on "Section 8.3 Termination Fees". VMware: "Section 5.12. Financing".
    const html = `${toc([["b1", "Financing of the Merger"], ["b2", "Termination Fee"], ["a1", "Financing"], ["a2", "Termination Fees"], ["a3", "Opinion of Financial Advisor"]])}
      <p id="b1">Financing of the Merger Parent and Merger Sub have represented</p><p id="b2">Termination Fee If Proofpoint terminates</p>
      <p>${"The rest of the proxy. ".repeat(600)}</p>
      <p id="a1">Section 4.4 Financing. (a) Parent or certain of its controlled Affiliates</p><p id="a2">Section 8.3 Termination Fees. (a) Company Termination Fee</p><p id="a3">3.22 Opinion of Financial Advisor. The Company Board has received</p>`;
    expect(links(html)).toEqual(["Financing #b1", "Termination fees #b2"]);
  });

  it("skips a page-level anchor on the agreement's page, but not an amount before a heading", () => {
    // Xilinx's anchor is on the page that holds "Section 3.21 Opinion of Financial Advisor".
    const xilinx = `${toc([["p", "Opinion of Financial Advisor"]])}<p id="p">state anti-takeover statutes and any similar provisions</p><p>Section 3.21 Opinion of Financial Advisor. The Parent Board</p>`;
    expect(links(xilinx)).toEqual([]);
    // Atrion's page in the body: the sentence before the heading ends in an amount.
    const atrion = `${toc([["p", "Recommendation of the Board of Directors and Reasons for the Merger"]])}<p id="p">Exhibit A to the Merger Agreement, par value $0.001 Recommendation of the Board of Directors and Reasons for the Merger</p>`;
    expect(links(atrion)).toEqual(["Board's reasons #p"]);
  });

  it("keeps a bank's annexed letter only when the contents links no opinion section", () => {
    // Webster's opinion link landed on "Annex D February 3, 2026", with the body's section linked too.
    const both = `${toc([["b", "Opinion of J.P. Morgan Securities LLC"], ["a", "Opinion of J.P. Morgan Securities LLC"]])}<p id="b">Opinion of J.P. Morgan Securities LLC Pursuant to</p><p id="a">Annex D February 3, 2026 The Board of Directors</p>`;
    expect(links(both)).toEqual(["Opinion of J.P. Morgan Securities #b"]);
    // Nuvalent, 1st Constitution: the letter is all there is. Roman annex numbers and capitals too.
    expect(links(`${toc([["a", "Opinion of Centerview Partners LLC"]])}<p id="a">Annex A Centerview Partners LLC</p>`)).toEqual(["Opinion of Centerview Partners #a"]);
    expect(links(`${toc([["a", "Opinion of Piper Sandler"]])}<p id="a">ANNEX II Opinion of Financial Advisor</p>`)).toEqual(["Opinion of Piper Sandler #a"]);
    // William Penn: the letter's page starts at its date, under an annex heading on the page before.
    const penn = `${toc([["b", "Opinion of William Penn’s Financial Advisor"], ["a", "Opinion of Keefe, Bruyette & Woods"]])}<p id="b">Opinion of William Penn’s Financial Advisor</p><p id="a">October 31, 2024 The Board of Directors Mid Penn Bancorp</p>`;
    expect(links(penn)).toEqual(["Opinion of William Penn’s Financial Advisor #b"]);
    // Some other annex section never stands in: Societal's Pennsylvania statute.
    expect(links(`${toc([["a", "Appraisal Rights"]])}<p id="a">Annex II PENNSYLVANIA BUSINESS CORPORATION LAW</p>`)).toEqual([]);
  });

  it("stops at an annex row once a section was seen, even if that link was a letter", () => {
    // PacWest: its one opinion link landed on a letter; the agreement's contents after the annex row aren't the proxy's.
    const html = `${toc([["a", "Opinion of J.P. Morgan Securities LLC"], ["x", "Annex A Agreement and Plan of Merger"], ["t", "Termination Fee"]])}<p id="a">Annex L July 25, 2023</p><p id="x">Annex A</p><p id="t">Termination Fee”); provided that</p>`;
    expect(links(html)).toEqual(["Opinion of J.P. Morgan Securities #a"]);
  });

  it("doesn't let the buyer's reasons replace the board's recommendation on a joint proxy", () => {
    // Webster: "Santander’s Reasons for the Transaction" came after the board's. Pioneer: "EXXONMOBIL’S REASONS FOR THE MERGER". Manitex: "Tadano Purpose of and Reasons for the Merger".
    for (const buyer of ["Santander’s Reasons for the Transaction", "EXXONMOBIL’S REASONS FOR THE MERGER", "Tadano Purpose of and Reasons for the Merger"]) {
      expect(links(`${toc([["t", "Webster’s Reasons for the Transaction; Recommendation of the Webster Board"], ["b", buyer]])}<p id="t">x</p><p id="b">y</p>`)).toEqual(["Board's reasons #t"]);
    }
    // A plain last link still wins: summary, then body.
    expect(links(`${toc([["s", "Reasons for the Merger"], ["b", "Reasons for the Merger"]])}<p id="s">x</p><p id="b">y</p>`)).toEqual(["Board's reasons #b"]);
    expect(links(`${toc([["s", "Recommendation of the Board; Reasons for the Merger"], ["b", "Recommendation of the Board and Reasons for the Merger"]])}<p id="s">x</p><p id="b">y</p>`)).toEqual(["Board's reasons #b"]);
    // The target's section last stays last (Dominion, AvalonBay).
    expect(links(`${toc([["n", "NextEra Energy’s Reasons for the Merger"], ["d", "Dominion Energy’s Reasons for the Merger; Recommendation of the Dominion Board"]])}<p id="n">x</p><p id="d">y</p>`)).toEqual(["Board's reasons #d"]);
  });

  it("reads opinion headings with dashes and accents, and drops plurals only for a named bank", () => {
    // Summit: "Opinion of Summit’s Financial Advisor – Morgan Stanley". Crinetics spells it two ways: summary and body are one link.
    const summit = `${toc([["s", "Opinion of Crinetics’ Financial Advisor—J.P. Morgan Securities LLC"], ["b", "Opinion of Crinetics’ Financial Advisor — J.P. Morgan Securities LLC"], ["l", "Opinion of Crinetics’ Financial Advisor — Leerink Partners LLC"]])}<p id="s">x</p><p id="b">y</p><p id="l">z</p>`;
    expect(links(summit)).toEqual(["Opinion of Crinetics’ Financial Advisor – J.P. Morgan Securities #b", "Opinion of Crinetics’ Financial Advisor – Leerink Partners #l"]);
    expect(links(`${toc([["z", "Opinion of Lazard Frères & Co. LLC"]])}<p id="z">x</p>`)).toEqual(["Opinion of Lazard Frères #z"]);
    // Intra-Cellular: "Opinions of ITI’s Financial Advisors – Opinion of Centerview Partners LLC".
    expect(opinionLabel("Opinions of ITI’s Financial Advisors – Opinion of Centerview Partners LLC")).toBe("Opinion of Centerview Partners");
    expect(opinionLabel("Opinion of Lazard Fr è res & Co. LLC")).toBe("Opinion of Lazard Frères");
    // TopBuild: another party's singular heading doesn't remove the target's plural.
    const qxo = `${toc([["t", "Opinions of TopBuild’s Financial Advisors"], ["q", "Opinion of QXO’s Financial Advisor"]])}<p id="t">x</p><p id="q">y</p>`;
    expect(links(qxo)).toEqual(["Opinions of TopBuild’s Financial Advisors #t", "Opinion of QXO’s Financial Advisor #q"]);
    // Slack: named banks replace "Opinions of Slack Financial Advisors".
    const slack = `${toc([["p", "Opinions of Slack Financial Advisors"], ["g", "Opinion of Goldman Sachs & Co. LLC"], ["q", "Opinion of Qatalyst Partners LP"]])}<p id="p">x</p><p id="g">y</p><p id="q">z</p>`;
    expect(links(slack)).toEqual(["Opinion of Goldman Sachs #g", "Opinion of Qatalyst Partners #q"]);
    // A heading naming no one goes when something exact is there (Kenvue's summary), and stays when it's all there is.
    const kenvue = `${toc([["s", "Opinions of Financial Advisors"], ["b", "Opinion of Kenvue’s Financial Advisor"]])}<p id="s">x</p><p id="b">y</p>`;
    expect(links(kenvue)).toEqual(["Opinion of Kenvue’s Financial Advisor #b"]);
    expect(links(`${toc([["s", "Opinions of Financial Advisors"]])}<p id="s">x</p>`)).toEqual(["Opinions of Financial Advisors #s"]);
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
