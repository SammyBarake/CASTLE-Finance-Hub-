import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getText } from "./edgar";

// The ingest keeps several documents in flight (prefetching in deals.ts); the throttle must still start them one slot apart.
describe("EDGAR throttle", () => {
  const starts: number[] = [];
  beforeEach(() => {
    process.env.SEC_USER_AGENT = "Castle test test@example.com";
    starts.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response("ok", { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("spaces concurrent requests at least 125 ms apart", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const all = Promise.all(Array.from({ length: 5 }, (_, i) => getText(`https://efts.sec.gov/test-${i}`)));
    await vi.advanceTimersByTimeAsync(2_000);
    await all;
    vi.useRealTimers();
    expect(starts).toHaveLength(5);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(125);
  });

  it("holds every waiting caller back after a rate-limit answer", async () => {
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        starts.push(Date.now());
        if (first) {
          first = false;
          return new Response("slow down", { status: 429 });
        }
        return new Response("ok", { status: 200 });
      }),
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const a = getText("https://efts.sec.gov/a");
    await vi.advanceTimersByTimeAsync(2_000); // a's 429 has come back (after any slot the first test left reserved)
    expect(starts).toHaveLength(1);
    const b = getText("https://efts.sec.gov/b"); // another caller, asking after it
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all([a, b]);
    vi.useRealTimers();
    // b waited out the ten seconds as well, instead of firing at the next slot.
    expect(starts.length).toBe(3);
    expect(Math.min(starts[1], starts[2]) - starts[0]).toBeGreaterThanOrEqual(10_000);
  });
});

// The document cache travels between rebuilds (ingest.yml), so it must never hold a partial file or a temporary one.
describe("EDGAR document cache", () => {
  let dir = "";
  beforeEach(() => {
    process.env.SEC_USER_AGENT = "Castle test test@example.com";
    dir = mkdtempSync(join(tmpdir(), "edgar-cache-"));
    process.env.EDGAR_CACHE_DIR = dir;
    vi.resetModules(); // the cache directory is read when the module loads
    vi.stubGlobal("fetch", vi.fn(async () => new Response("the filed document", { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EDGAR_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes each document whole under its own name and answers the next read from disk", async () => {
    const edgar = await import("./edgar");
    const url = "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/ex99.htm";
    expect(await edgar.getText(url)).toBe("the filed document");
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{40}$/); // no .tmp left behind
    expect(readFileSync(join(dir, files[0]), "utf8")).toBe("the filed document");
    expect(await edgar.getText(url)).toBe("the filed document");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(edgar.edgarRequestStats()).toMatchObject({ archive: 1, cacheHits: 1, cacheFiles: 1, cacheWrites: 1 });
  });

  it("doesn't fail a read when the cache can't be written", async () => {
    process.env.EDGAR_CACHE_DIR = join(dir, "not-a-dir");
    writeFileSync(process.env.EDGAR_CACHE_DIR, "a file where the directory should be");
    vi.resetModules();
    const edgar = await import("./edgar");
    expect(await edgar.getText("https://www.sec.gov/Archives/edgar/data/1/000000000126000002/ex99.htm")).toBe("the filed document");
    expect(edgar.edgarRequestStats().cacheWrites).toBe(0);
  });

  it("caches nothing but filed documents", async () => {
    const edgar = await import("./edgar");
    await edgar.getText("https://efts.sec.gov/LATEST/search-index?q=merger");
    await edgar.getText("https://data.sec.gov/submissions/CIK0000000001.json");
    expect(readdirSync(dir)).toHaveLength(0);
  });
});
