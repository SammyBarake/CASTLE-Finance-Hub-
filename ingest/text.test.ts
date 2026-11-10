import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "./text";

describe("decodeEntities", () => {
  it("reads code points 128–159 as Windows-1252, as older EDGAR filings mean them", () => {
    expect(decodeEntities("(the &#147;Company&#148;)")).toBe("(the “Company”)");
    expect(decodeEntities("Company&#146;s &#150; 2019&#151;")).toBe("Company’s – 2019—");
    expect(decodeEntities("&#x93;Parent&#x94;")).toBe("“Parent”");
    // Raw control characters from the same encoding.
    expect(decodeEntities("(the \u0093Company\u0094)")).toBe("(the “Company”)");
  });

  it("leaves ordinary entities alone", () => {
    expect(decodeEntities("&amp; &#8220;x&#8221; &auml;")).toBe("& “x” ä");
  });
});

describe("htmlToText", () => {
  it("turns an older filing's defined terms into straight-quoted ones the parsers read", () => {
    const html = "<html><body><p>Civitas Solutions, Inc., a Delaware corporation (the &#147;<U>Company</U>&#148;), entered into an Agreement and Plan of Merger (the &#147;<U>Merger Agreement</U>&#148;)</p></body></html>";
    const text = htmlToText(html);
    expect(text).toContain('(the " Company ")');
    expect(text).toContain("Agreement and Plan of Merger");
  });

  it("keeps the paragraphs of a release laid out as an image, whose hidden 1pt text layer marks them with runs of spaces", () => {
    const html =
      '<html><body><DIV><IMG src="p001.jpg"><DIV><FONT size="1" style="font-size:1pt;color:white">  FOR IMMEDIATE RELEASE    Federal Signal Completes Acquisition of Hog Technologies, A Leading U.S.  Manufacturer of Equipment    Downers Grove, Illinois, February 12, 2025 &#8212; Federal Signal Corporation (NYSE: FSS) today announced that it has  completed the acquisition of Hog Technologies.</FONT></DIV></DIV></body></html>';
    const lines = htmlToText(html).split("\n");
    expect(lines).toContain("Federal Signal Completes Acquisition of Hog Technologies, A Leading U.S. Manufacturer of Equipment");
    expect(lines.some((l) => l.startsWith("Downers Grove, Illinois, February 12, 2025"))).toBe(true);
    // Elsewhere runs of spaces stay spaces.
    expect(htmlToText("<html><body><p>Acme    Corp</p></body></html>")).toBe("Acme Corp");
  });
});
