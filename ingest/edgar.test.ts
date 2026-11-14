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
