/**
 * Screen state <-> URL query, so a screened list is a link someone else can open (Deal Flow, Precedents).
 * Only values that differ from the defaults are written, and every value read back is checked against what the
 * screen accepts (an edited or stale link falls back to the default, never breaks the page).
 */

export type FieldSpec = { kind: "enum"; values: readonly string[] } | { kind: "number" } | { kind: "text" } | { kind: "bool" };
export type Spec<T> = { [K in keyof T]?: FieldSpec };

/** The query string for `state`: the fields in `spec` that differ from `defaults`, in spec order. */
export function encodeState<T extends object>(state: T, defaults: T, spec: Spec<T>): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(spec) as (keyof T)[]) {
    const value = state[key];
    if (value === defaults[key] || value == null || value === "") continue;
    params.set(String(key), typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  return params.toString();
}

/** `defaults` with the valid fields of `params` applied. */
export function decodeState<T extends object>(params: URLSearchParams | { get(key: string): string | null }, defaults: T, spec: Spec<T>): T {
  const out = { ...defaults };
  for (const [key, field] of Object.entries(spec) as [keyof T & string, FieldSpec][]) {
    const raw = params.get(key);
    if (raw == null) continue;
    const value = raw.trim().slice(0, 120);
    if (field.kind === "enum" && field.values.includes(value)) out[key] = value as T[typeof key];
    else if (field.kind === "number" && /^\d+(?:\.\d+)?$/.test(value)) out[key] = value as T[typeof key];
    else if (field.kind === "text" && value) out[key] = value as T[typeof key];
    else if (field.kind === "bool" && (value === "1" || value === "0")) out[key] = (value === "1") as T[typeof key];
  }
  return out;
}

/** Replace the current URL's query without a navigation (Next keeps its router in sync with the history API). */
export function replaceQuery(query: string) {
  if (typeof window === "undefined") return;
  const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", url);
}
