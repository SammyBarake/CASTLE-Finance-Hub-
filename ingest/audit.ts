/**
 * Data-quality audit: runs every rule in audit-rules.ts over the dataset and prints a summary with examples.
 *
 *   npm run audit              the live database (Supabase, read-only)
 *   npm run audit -- --local   .data/castle.json
 *   npm run audit -- --all     list every finding, not just examples
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { auditDeal, auditIpo, duplicateDeals, type Finding } from "./audit-rules";
import type { Deal, Ipo } from "../lib/types";

async function load(): Promise<{ deals: Deal[]; ipos: Ipo[]; asOf: string }> {
  if (process.argv.includes("--local")) {
    const raw = JSON.parse(readFileSync(".data/castle.json", "utf8"));
    return { deals: raw.deals, ipos: raw.ipos, asOf: raw.asOf ?? new Date().toISOString() };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, or pass --local");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const all = async <T,>(table: string): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select("data").range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []).map((r) => r.data as T));
      if (!data || data.length < 1000) return out;
    }
  };
  const [deals, ipos, meta] = await Promise.all([all<Deal>("deals"), all<Ipo>("ipos"), db.from("meta").select("value").eq("key", "asOf").maybeSingle()]);
  return { deals, ipos, asOf: (meta.data?.value as string) ?? new Date().toISOString() };
}

async function main() {
  const { deals, ipos, asOf } = await load();
  const findings: Finding[] = [...deals.flatMap((d) => auditDeal(d, asOf)), ...duplicateDeals(deals), ...ipos.flatMap((i) => auditIpo(i, asOf))];
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  const flagged = new Set(findings.map((f) => f.id));
  console.log(`Audited ${deals.length} deals and ${ipos.length} IPOs (data as of ${asOf}).`);
  console.log(`${flagged.size} records flagged (${((flagged.size / (deals.length + ipos.length)) * 100).toFixed(1)}%), ${findings.length} findings.\n`);
  const showAll = process.argv.includes("--all");
  for (const [rule, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(list.length).padStart(4)}  ${rule}`);
    for (const f of list.slice(0, showAll ? list.length : 4)) console.log(`        ${f.detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
