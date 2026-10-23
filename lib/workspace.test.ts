import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN } from "./screen";
import { DEFAULT_PREFS, legacyViewId, mergePrefs, prefsEqual, sanitize, stampChanges, syncWorkspace, type Prefs, type WorkspaceStore } from "./workspace";

/** A browser's copy: edits are stamped like components/workspace/store.ts stamps them. */
function device(start: Prefs = DEFAULT_PREFS) {
  let p = start;
  return {
    get: () => p,
    set: (n: Prefs) => (p = n),
    edit(fn: (p: Prefs) => Prefs, now: number) {
      const next = fn(p);
      p = { ...next, stamps: stampChanges(p, next, now) };
    },
  };
}
const star = (k: string) => (p: Prefs) => ({ ...p, watch: [...p.watch, k] });
const unstar = (k: string) => (p: Prefs) => ({ ...p, watch: p.watch.filter((x) => x !== k) });
const note = (k: string, text: string) => (p: Prefs) => {
  const notes = { ...p.notes };
  if (text) notes[k] = text;
  else delete notes[k];
  return { ...p, notes };
};

describe("sanitize", () => {
  it("reads copies saved before sync existed: screens get the same id every time, nothing invalid survives", () => {
    const legacy = { watch: ["deal:a", "deal:a", 7], views: [{ name: "Tech > $1B", screen: { sector: "Tech" } }], notes: { "deal:a": "Thesis", "deal:b": 3 }, density: "compact", stamps: { "w:deal:a": -1, ok: 5 } };
    const p = sanitize(legacy);
    expect(p.watch).toEqual(["deal:a"]);
    expect(p.views[0].id).toBe(legacyViewId("Tech > $1B", { ...DEFAULT_SCREEN, sector: "Tech" }));
    expect(sanitize(legacy).views[0].id).toBe(p.views[0].id);
    expect(p.notes).toEqual({ "deal:a": "Thesis" });
    expect(p.stamps).toEqual({ ok: 5 });
    expect(p.density).toBe("compact");
    expect(sanitize(null)).toEqual(DEFAULT_PREFS);
  });
});

describe("stampChanges", () => {
  it("stamps only what changed, deletions included, and never goes back in time", () => {
    const d = device();
    d.edit(star("deal:a"), 100);
    d.edit(note("deal:a", "Cheap vs comps"), 200);
    expect(d.get().stamps).toEqual({ "w:deal:a": 100, "n:deal:a": 200 });
    d.edit(unstar("deal:a"), 300);
    expect(d.get().stamps["w:deal:a"]).toBe(300);
    d.edit(note("deal:a", "Revised"), 50); // clock went back
    expect(d.get().stamps["n:deal:a"]).toBe(201);
    d.edit((p) => ({ ...p, density: "compact" }), 400);
    expect(d.get().stamps.density).toBe(400);
  });
});

describe("mergePrefs", () => {
  it("keeps both devices' edits instead of letting the last save win", () => {
    const laptop = device();
    const phone = device();
    laptop.edit(note("deal:a", "Laptop note"), 100);
    phone.edit(star("deal:b"), 110);
    const m = mergePrefs(laptop.get(), phone.get());
    expect(m.notes).toEqual({ "deal:a": "Laptop note" });
    expect(m.watch).toEqual(["deal:b"]);
  });

  it("lets a newer deletion beat an older copy, and a newer re-add beat the deletion", () => {
    const a = device();
    a.edit(star("deal:a"), 100);
    const b = device(a.get());
    a.edit(unstar("deal:a"), 200);
    expect(mergePrefs(b.get(), a.get()).watch).toEqual([]);
    b.set(mergePrefs(b.get(), a.get()));
    b.edit(star("deal:a"), 300);
    expect(mergePrefs(a.get(), b.get()).watch).toEqual(["deal:a"]);
  });

  it("never lets a new device's empty defaults wipe a workspace saved before sync existed", () => {
    const account = sanitize({ watch: ["deal:a"], columns: ["target", "acquirer"], density: "compact" });
    const fresh = sanitize({});
    const m = mergePrefs(fresh, account);
    expect(m.watch).toEqual(["deal:a"]);
    expect(m.columns).toEqual(["target", "acquirer"]);
    expect(m.density).toBe("compact");
  });

  it("forgets deletions over 180 days older than the latest change, the same way on every device", () => {
    const d = device();
    d.edit(star("deal:old"), 1_000);
    d.edit(unstar("deal:old"), 2_000);
    d.edit(star("deal:new"), 2_000 + 181 * 86_400_000);
    expect(d.get().stamps["w:deal:old"]).toBeUndefined();
    expect(d.get().stamps["w:deal:new"]).toBeDefined();
  });

  it("settles on one result whichever way round two devices merge, and merging again changes nothing", () => {
    // Seeded pseudo-random edits on two copies of a shared starting point.
    let seed = 42;
    const rand = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    const keys = ["deal:a", "deal:b", "deal:c", "ipo:d"];
    for (let round = 0; round < 200; round++) {
      const base = device();
      for (let i = 0; i < 3; i++) base.edit(star(keys[rand(4)]), 10 + i);
      const a = device(base.get());
      const b = device(base.get());
      for (let i = 0; i < 6; i++) {
        const d = rand(2) ? a : b;
        const k = keys[rand(4)];
        const t = 100 + rand(50); // overlapping times, ties included
        const op = rand(5);
        if (op === 0) d.edit(d.get().watch.includes(k) ? unstar(k) : star(k), t);
        else if (op === 1) d.edit(note(k, `n${rand(3)}`), t);
        else if (op === 2) d.edit(note(k, ""), t);
        else if (op === 3) d.edit((p) => ({ ...p, density: rand(2) ? "compact" : "comfortable" }), t);
        else d.edit((p) => ({ ...p, motion: !p.motion }), t);
      }
      const ab = mergePrefs(a.get(), b.get());
      const ba = mergePrefs(b.get(), a.get());
      expect(prefsEqual(ab, ba)).toBe(true);
      expect(prefsEqual(mergePrefs(ab, b.get()), ab)).toBe(true);
      expect(prefsEqual(mergePrefs(ab, ab), ab)).toBe(true);
    }
  });
});

/** The account's copy in memory, with a hook to let "another device" save between a read and an update. */
function memoryStore(): WorkspaceStore & { row: { prefs: unknown; rev: number } | null; beforeUpdate?: () => Promise<void> } {
  const s = {
    row: null as { prefs: unknown; rev: number } | null,
    beforeUpdate: undefined as undefined | (() => Promise<void>),
    async read() {
      return s.row ? { prefs: structuredClone(s.row.prefs), rev: s.row.rev } : null;
    },
    async create(p: Prefs) {
      if (s.row) return false;
      s.row = { prefs: structuredClone(p), rev: 0 };
      return true;
    },
    async update(p: Prefs, rev: number) {
      const hook = s.beforeUpdate;
      s.beforeUpdate = undefined;
      if (hook) await hook();
      if (!s.row || s.row.rev !== rev) return null;
      s.row = { prefs: structuredClone(p), rev: rev + 1 };
      return s.row.rev;
    },
  };
  return s;
}

describe("syncWorkspace", () => {
  it("creates the account's copy, then brings a second device's edits together with it", async () => {
    const store = memoryStore();
    const laptop = device();
    laptop.edit(star("deal:a"), 100);
    expect(await syncWorkspace(store, laptop)).toBe("saved");
    expect(store.row?.rev).toBe(0);

    const phone = device();
    phone.edit(note("deal:b", "Phone note"), 200);
    expect(await syncWorkspace(store, phone)).toBe("saved");
    expect(phone.get().watch).toEqual(["deal:a"]);
    expect(await syncWorkspace(store, laptop)).toBe("unchanged");
    expect(laptop.get().notes).toEqual({ "deal:b": "Phone note" });
  });

  it("loses nothing when two devices save at the same moment", async () => {
    const store = memoryStore();
    const a = device();
    const b = device();
    await syncWorkspace(store, a);
    await syncWorkspace(store, b);
    a.edit(star("deal:a"), 100);
    b.edit(star("deal:b"), 101);
    // b saves after a has read the account's copy but before a writes: a's write is refused, a reads again and merges.
    store.beforeUpdate = async () => void (await syncWorkspace(store, b));
    expect(await syncWorkspace(store, a)).toBe("saved");
    expect(sanitize(store.row!.prefs).watch.sort()).toEqual(["deal:a", "deal:b"]);
    await syncWorkspace(store, b);
    expect(b.get().watch.sort()).toEqual(["deal:a", "deal:b"]);
  });
});
