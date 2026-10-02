"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PanelHead } from "@/components/ui/primitives";
import { FEATURES, MACROS, type Feature, type Macro } from "@/lib/ripple/links";
import { FEATURE_LABELS, formatShock, MACRO_LABELS, PRESETS, rangeFor, sameTarget, targetLabel, type ShockInput, type ShockTarget } from "@/lib/ripple/settings";
import { SECTORS, type Sector } from "@/lib/types";

const MAX_SHOCKS = 4;
/** Size a new shock starts at when its variable changes (units differ between % and pp). */
const DEFAULT_SIZE: Record<Feature | Macro, number> = { valuation: 10, dealCount: 10, dealValue: 10, ipoCount: 20, fedFunds: 1, treasury10y: 1, baaSpread: 1, vix: 10 };

const sameShocks = (a: ShockInput[], b: ShockInput[]) => a.length === b.length && a.every((s, i) => sameTarget(s.target, b[i].target) && s.size === b[i].size);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function ScenarioPanel({
  shocks,
  onChange,
  editing,
  onEdit,
}: {
  shocks: ShockInput[];
  /** "preset" when a preset was picked, "edit" for any change made in the editor. */
  onChange: (s: ShockInput[], kind: "preset" | "edit") => void;
  editing: number;
  onEdit: (i: number) => void;
}) {
  const current = shocks[editing] ?? shocks[0];
  const range = current ? rangeFor(current.target) : null;
  // The number box keeps what's typed (e.g. "-" or "1.") until it parses; the slider and the engine get clamped numbers.
  const [draft, setDraft] = useState(current ? String(current.size) : "");
  const size = current?.size;
  const key = current ? targetLabel(current.target) : "";
  // Re-sync only when the value or the target really changes, so "1." survives while the user types "1.5".
  useEffect(() => setDraft(size == null ? "" : String(size)), [size, key, editing]); // eslint-disable-line react-hooks/set-state-in-effect -- mirror the edited shock

  const update = (patch: Partial<ShockInput>) => onChange(shocks.map((s, i) => (i === editing ? { ...s, ...patch } : s)), "edit");
  const setVariable = (v: Feature | Macro) => {
    const target: ShockTarget = (FEATURES as readonly string[]).includes(v)
      ? { kind: "feature", feature: v as Feature, sector: current?.target.kind === "feature" ? current.target.sector : "Tech" }
      : { kind: "macro", macro: v as Macro };
    update({ target, size: DEFAULT_SIZE[v] });
  };
  const variable = current ? (current.target.kind === "feature" ? current.target.feature : current.target.macro) : "valuation";

  // Slider fill runs from zero to the value, so up and down shocks read at a glance.
  const fill = range && current ? { lo: ((Math.min(0, current.size) - range.min) / (range.max - range.min)) * 100, hi: ((Math.max(0, current.size) - range.min) / (range.max - range.min)) * 100 } : null;

  return (
    <section className="panel whatif-scenario">
      <PanelHead title="Scenario" subtitle="Pick a preset or build your own: shocks hit in Q1 and ripple out over four quarters">
        <div className="whatif-presets" role="group" aria-label="Preset scenarios">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="whatif-preset" aria-pressed={sameShocks(shocks, p.shocks)} title={p.note} onClick={() => (onChange(p.shocks, "preset"), onEdit(0))}>
              {p.label}
            </button>
          ))}
        </div>
      </PanelHead>

      <div className="whatif-builder">
        <div className="whatif-shocks" aria-label="Shocks in this scenario">
          {shocks.map((s, i) => (
            <span key={i} className={`whatif-chip ${i === editing ? "active" : ""}`}>
              <button type="button" onClick={() => onEdit(i)} aria-pressed={i === editing} aria-label={`Edit shock: ${targetLabel(s.target)} ${formatShock(s)}`}>
                {targetLabel(s.target)}
                <b className={s.size >= 0 ? "up" : "down"}>{formatShock(s)}</b>
              </button>
              {shocks.length > 1 && (
                <button type="button" className="whatif-chip-x" aria-label={`Remove ${targetLabel(s.target)}`} onClick={() => (onChange(shocks.filter((_, j) => j !== i), "edit"), onEdit(Math.max(0, editing >= i ? editing - 1 : editing)))}>
                  <Icon name="close" />
                </button>
              )}
            </span>
          ))}
          {shocks.length < MAX_SHOCKS && (
            <button type="button" className="whatif-add" onClick={() => (onChange([...shocks, { target: { kind: "macro", macro: "vix" }, size: 10 }], "edit"), onEdit(shocks.length))}>
              + Add shock
            </button>
          )}
        </div>

        {current && range && (
          <div className="whatif-editor">
            <label className="whatif-field">
              <span>Shock</span>
              <span className="select-wrap">
                <select value={variable} onChange={(e) => setVariable(e.target.value as Feature | Macro)}>
                  <optgroup label="Sector">
                    {FEATURES.map((f) => (
                      <option key={f} value={f}>
                        {FEATURE_LABELS[f]}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Macro">
                    {MACROS.map((m) => (
                      <option key={m} value={m}>
                        {MACRO_LABELS[m]}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </span>
            </label>
            {current.target.kind === "feature" ? (
              <label className="whatif-field">
                <span>Sector</span>
                <span className="select-wrap">
                  <select value={current.target.sector} onChange={(e) => update({ target: { ...current.target, sector: e.target.value as Sector } as ShockTarget })}>
                    {SECTORS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            ) : (
              <div className="whatif-field whatif-field-note">
                <span>Units</span>
                <small>{range.unit === "pp" ? "Percentage points (1 = 100 bp)" : "VIX index points"}</small>
              </div>
            )}
            <label className="whatif-field whatif-slider">
              <span>
                Size
                <small>
                  {range.min}
                  {range.unit === "%" ? "%" : ""} to +{range.max}
                  {range.unit === "%" ? "%" : ` ${range.unit}`}
                </small>
              </span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={current.size}
                onChange={(e) => update({ size: Number(e.target.value) })}
                aria-valuetext={formatShock(current)}
                className={current.size >= 0 ? "up" : "down"}
                style={fill ? ({ "--lo": `${fill.lo}%`, "--hi": `${fill.hi}%` } as React.CSSProperties) : undefined}
              />
            </label>
            <label className="whatif-field whatif-number">
              <span>Value</span>
              <span className="whatif-number-box">
                <input
                  type="number"
                  inputMode="decimal"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    const v = Number(e.target.value);
                    if (e.target.value !== "" && Number.isFinite(v)) update({ size: clamp(v, range.min, range.max) });
                  }}
                  onBlur={() => setDraft(String(current.size))}
                />
                <i>{range.unit}</i>
              </span>
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
