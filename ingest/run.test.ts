/**
 * The whole run against a stand-in database: what a run does with buyers' reactions, which can't be fetched again
 * (ingest/reactions.ts). carryReactions has its own tests; these check that run.ts and store.ts really use it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeldReaction } from "./reactions";
import type { StoredDeal } from "./store";

type Row = Record<string, unknown>;
type Op = { op: "select" | "upsert" | "delete"; table: string };

/** The little of Supabase's client that store.ts uses. Rows are copied in and out, like a real database's. */
class FakeDb {
  tables = new Map<string, Map<string, Row>>();
  ops: Op[] = [];
  /** An error message fails that call. */
  fail: ((op: Op) => string | null) | null = null;

  rows(table: string) {
    return [...(this.tables.get(table)?.values() ?? [])];
  }
  seed(table: string, rows: Row[]) {
    const t = this.tables.get(table) ?? new Map<string, Row>();
    for (const r of rows) t.set(String(r.id ?? r.key), JSON.parse(JSON.stringify(r)));
    this.tables.set(table, t);
  }
  private answer(op: Op, run: () => unknown) {
    this.ops.push(op);
    const message = this.fail?.(op);
    return Promise.resolve(message ? { data: null, error: { message } } : { data: run() ?? null, error: null });
  }
  from(table: string) {
    return {
      select: () => ({
        range: (a: number, b: number) => this.answer({ op: "select", table }, () => JSON.parse(JSON.stringify(this.rows(table).slice(a, b + 1)))),
        in: (col: string, values: unknown[]) => this.answer({ op: "select", table }, () => JSON.parse(JSON.stringify(this.rows(table).filter((r) => values.includes(r[col]))))),
      }),
      upsert: (rows: Row | Row[]) => this.answer({ op: "upsert", table }, () => this.seed(table, Array.isArray(rows) ? rows : [rows])),
      delete: () => ({
        in: (_col: string, ids: string[]) =>
          this.answer({ op: "delete", table }, () => {
            for (const id of ids) this.tables.get(table)?.delete(id);
          }),
      }),
    };
  }
}

type Ingest = (state: { deals: StoredDeal[]; dropped?: Set<string> }, opts: { checkpoint: () => Promise<void> }) => Promise<unknown>;

const h = vi.hoisted(() => ({ db: null as unknown, ingest: null as unknown }));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => h.db }));
vi.mock("./deals", () => ({
  ingestDeals: (state: unknown, opts: unknown) => (h.ingest as Ingest)(state as never, opts as never),
  buildDirectory: () => ({ byTicker: new Map() }),
}));
vi.mock("./edgar", () => ({ getListedCompanies: async () => [], edgarRequestCount: () => 0 }));
vi.mock("./ipos", () => ({ ingestIpos: async () => ({ candidates: 0, pipeline: 0 }) }));
vi.mock("./activists", () => ({ ingestActivists: async () => ({ added: 0, total: 0 }) }));
vi.mock("./macro", () => ({
  fetchMacro: async () => {
    throw new Error("not in this test");
  },
}));

const STATS = { documents: 0, parsed: 0, privateDeals: 0, newDeals: 0, enriched: 0, valuesFound: 0, sponsorsFound: 0, advisorsFound: 0, buyersLinked: 0, searchGaps: [] as string[] };
const reaction = { announcementPct: -5, announcementVsMarketPct: -6, m6VsMarketPct: 2.5, y1VsMarketPct: null };

const record = (name: string, cik: string): StoredDeal =>
  ({
    id: `${cik}-2024-03-04`,
    announcedDate: "2024-03-04",
    status: "Closed",
    acquirer: { name: `Buyer of ${name}`, ticker: null, cik: `9${cik}` },
    target: { name, ticker: null, cik },
  }) as StoredDeal;
const bare = (d: StoredDeal): StoredDeal => {
  const copy = JSON.parse(JSON.stringify(d));
  delete copy.reaction;
  delete copy.reactionCheckedAt;
  return copy;
};
const withReaction = (d: StoredDeal): StoredDeal => ({ ...d, reaction, reactionCheckedAt: "2026-11-01" });
const held = (d: StoredDeal): HeldReaction => {
  const { id, announcedDate, acquirer, target } = d;
  return { id, announcedDate, acquirer, target, reaction, reactionCheckedAt: "2026-11-01" };
};

const A = record("Alpha", "1");
const B = record("Bravo", "2");

/** A database holding these deals (each with its reaction) and these parked reactions. */
function seeded(deals: StoredDeal[], parked: HeldReaction[] = []) {
  const db = new FakeDb();
  db.seed("deals", deals.map((d) => ({ id: d.id, announced_date: d.announcedDate, status: d.status, data: d })));
  db.seed("meta", [{ key: "asOf", value: "2026-11-01T00:00:00Z" }, { key: "unplacedReactions", value: parked }]);
  h.db = db;
  return db;
}

const stored = (db: FakeDb) => new Map(db.rows("deals").map((r) => [r.id as string, r.data as StoredDeal]));
const parked = (db: FakeDb) => (db.rows("meta").find((m) => m.key === "unplacedReactions")?.value ?? []) as HeldReaction[];

/** Runs the real ingest/run.ts once with these arguments. */
async function run(args: string[], ingest: Ingest) {
  h.ingest = ingest;
  process.argv = ["node", "run.ts", ...args];
  vi.resetModules();
  const { finished } = await import("./run");
  await finished;
}

const REBUILD = ["--only", "deals", "--rebuild-deals", "--from", "2021-01-01"];

describe("a run and its reactions", () => {
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.SUPABASE_URL = "http://stand-in";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stand-in";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an ordinary run parks the reaction of a record it drops, instead of losing it", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    await run(["--only", "deals"], async (state) => {
      state.deals = state.deals.filter((d) => d.id !== B.id);
      (state.dropped ??= new Set()).add(B.id);
      return STATS;
    });
    expect(stored(db).has(B.id)).toBe(false);
    expect(parked(db).map((p) => p.id)).toEqual([B.id]);
    expect(stored(db).get(A.id)?.reaction).toEqual(reaction);
  });

  it("an ordinary run with nothing to do changes no reaction and parks nothing", async () => {
    const db = seeded([withReaction(A)]);
    await run(["--only", "deals"], async () => STATS);
    expect(stored(db).get(A.id)?.reaction).toEqual(reaction);
    expect(parked(db)).toEqual([]);
  });

  it("a rebuild has handed every reaction on by each save, the checkpoints too", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    let atCheckpoint: StoredDeal | undefined;
    let parkedAtCheckpoint: string[] = [];
    await run(REBUILD, async (state, opts) => {
      expect(state.deals).toEqual([]);
      state.deals.push(bare(A));
      await opts.checkpoint();
      atCheckpoint = stored(db).get(A.id);
      parkedAtCheckpoint = parked(db).map((p) => p.id);
      state.deals.push(bare(B));
      return STATS;
    });
    expect(atCheckpoint?.reaction).toEqual(reaction);
    expect(parkedAtCheckpoint).toEqual([B.id]);
    expect(stored(db).get(A.id)?.reaction).toEqual(reaction);
    expect(stored(db).get(B.id)?.reaction).toEqual(reaction);
    expect(parked(db)).toEqual([]);
  });

  it("a rebuild that fails half way loses nothing, and the next run settles it", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    await run(REBUILD, async (state) => {
      state.deals.push(bare(A));
      throw new Error("EDGAR went away");
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(db.ops.some((o) => o.op === "delete" && o.table === "deals")).toBe(false);
    expect(stored(db).get(A.id)?.reaction).toEqual(reaction);
    expect(stored(db).get(B.id)?.reaction).toEqual(reaction);
    expect(parked(db).map((p) => p.id)).toEqual([B.id]);
    await run(["--only", "deals"], async () => STATS);
    expect(parked(db)).toEqual([]);
    expect(stored(db).get(B.id)?.reaction).toEqual(reaction);
  });

  it("a rebuild out of time while reading keeps every stored deal and the last asOf", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    await run(REBUILD, async (state) => {
      state.deals.push(bare(A));
      return { ...STATS, outOfTime: "reading" };
    });
    expect(exit).not.toHaveBeenCalled();
    expect(db.ops.some((o) => o.op === "delete" && o.table === "deals")).toBe(false);
    expect(stored(db).has(B.id)).toBe(true);
    expect(db.rows("meta").find((m) => m.key === "asOf")?.value).toBe("2026-11-01T00:00:00Z");
  });

  it("a rebuild out of time while enriching prunes, but leaves asOf for the run that finishes the enriching", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    await run(REBUILD, async (state) => {
      state.deals.push(bare(A));
      return { ...STATS, outOfTime: "enriching" };
    });
    expect(stored(db).has(B.id)).toBe(false);
    expect(parked(db).map((p) => p.id)).toEqual([B.id]);
    expect(db.rows("meta").find((m) => m.key === "asOf")?.value).toBe("2026-11-01T00:00:00Z");
    await run(["--only", "deals"], async () => STATS);
    expect(db.rows("meta").find((m) => m.key === "asOf")?.value).not.toBe("2026-11-01T00:00:00Z");
  });

  it("passes --deadline-minutes on as a deadline from the start of the run", async () => {
    seeded([withReaction(A)]);
    let deadline: number | undefined;
    const before = Date.now();
    await run(["--only", "deals", "--deadline-minutes", "285"], async (_state, opts) => {
      deadline = (opts as unknown as { deadline?: number }).deadline;
      return STATS;
    });
    expect(deadline! - before).toBeGreaterThanOrEqual(285 * 60_000 - 5_000);
    expect(deadline! - before).toBeLessThanOrEqual(285 * 60_000 + 5_000);
  });

  it("a rebuild's prune can't lose what found no record, and a later rebuild puts it back", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    await run(REBUILD, async (state) => {
      state.deals.push(bare(A));
      return STATS;
    });
    expect(stored(db).has(B.id)).toBe(false);
    expect(parked(db).map((p) => p.id)).toEqual([B.id]);
    await run(REBUILD, async (state) => {
      state.deals.push(bare(A), bare(B));
      return STATS;
    });
    expect(stored(db).get(B.id)?.reaction).toEqual(reaction);
    expect(parked(db)).toEqual([]);
  });

  it("parks before deleting: a save that dies after the prune has already written the parked list", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    let pruned = false;
    db.fail = (op) => {
      if (op.op === "delete" && op.table === "deals") pruned = true;
      return pruned && op.table === "ipos" ? "permission denied" : null;
    };
    await run(REBUILD, async (state) => {
      state.deals.push(bare(A));
      return STATS;
    });
    expect(pruned).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stored(db).has(B.id)).toBe(false);
    expect(parked(db).map((p) => p.id)).toEqual([B.id]);
  });

  it("a parked figure that finds its record stays parked until that record is written", async () => {
    const db = seeded([], [held(B)]);
    db.fail = (op) => (op.op === "upsert" && op.table === "deals" ? "permission denied" : null);
    const rereadB: Ingest = async (state) => {
      state.deals.push(bare(B));
      return STATS;
    };
    await run(["--only", "deals"], rereadB);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stored(db).has(B.id)).toBe(false);
    expect(parked(db).map((p) => p.id)).toEqual([B.id]);
    db.fail = null;
    await run(["--only", "deals"], rereadB);
    expect(stored(db).get(B.id)?.reaction).toEqual(reaction);
    expect(parked(db)).toEqual([]);
  });

  it("a rebuild leaves the data's date alone until it has finished, so the site stays on its last full snapshot", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    const asOf = () => db.rows("meta").find((m) => m.key === "asOf")?.value;
    let duringRebuild: unknown;
    await run(REBUILD, async (state, opts) => {
      state.deals.push(bare(A));
      await opts.checkpoint();
      duringRebuild = asOf();
      state.deals.push(bare(B));
      return STATS;
    });
    expect(duringRebuild).toBe("2026-11-01T00:00:00Z");
    expect(asOf()).not.toBe("2026-11-01T00:00:00Z");
    // A failed one too: the site shows stale data, not half-rebuilt rows.
    const failed = seeded([withReaction(A), withReaction(B)]);
    await run(REBUILD, async (state) => {
      state.deals.push(bare(A));
      throw new Error("EDGAR went away");
    });
    expect(failed.rows("meta").find((m) => m.key === "asOf")?.value).toBe("2026-11-01T00:00:00Z");
  });

  it("an ordinary run moves the date at its checkpoints and at the end", async () => {
    const db = seeded([withReaction(A)]);
    let atCheckpoint: unknown;
    await run(["--only", "deals"], async (_state, opts) => {
      await opts.checkpoint();
      atCheckpoint = db.rows("meta").find((m) => m.key === "asOf")?.value;
      return STATS;
    });
    expect(atCheckpoint).not.toBe("2026-11-01T00:00:00Z");
  });

  it("failed rebuilds don't pile up copies in the parked list", async () => {
    const db = seeded([withReaction(A), withReaction(B)]);
    for (let i = 0; i < 3; i++) {
      await run(REBUILD, async (state) => {
        state.deals.push(bare(A));
        throw new Error("EDGAR went away");
      });
    }
    expect(parked(db).map((p) => p.id)).toEqual([B.id]);
  });

  it("refuses a step that doesn't exist, rather than moving the data's date while doing nothing", async () => {
    const db = seeded([withReaction(A)]);
    let ran = false;
    await run(["--only", "prices"], async () => {
      ran = true;
      return STATS;
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(ran).toBe(false);
    expect(db.rows("meta").find((m) => m.key === "asOf")?.value).toBe("2026-11-01T00:00:00Z");
  });
});
