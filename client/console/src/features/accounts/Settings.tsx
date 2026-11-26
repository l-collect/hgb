import { useEffect, useState, type ReactNode } from "react";
import { api, enc } from "../../api/client";
import { settingVisible, type CloudTask, type ConfigView, type GameAccount, type GameTask, type SettingField, type TaskStepDetail } from "../../api/types";
import { Button, Card, CardHead, Check, Chips, Choices, Empty, FootBar, Pill, Row, Stepper, Switch, ui } from "../../components/ui";
import { useAction } from "../../components/useAction";
import { Link } from "../../router";
import { useConsole } from "../../state/context";
import s from "./Accounts.module.css";

function compactLabel(label: string): string {
  const noParen = label.replace(/\s*[（(][^）)]*[）)]\s*$/, "").trim();
  const beforeColon = (noParen.split(/[：:]/)[0] || noParen).trim();
  const dot = beforeColon.lastIndexOf("·");
  const core = dot > 0 && dot < beforeColon.length - 1 ? beforeColon.slice(dot + 1).trim() : beforeColon;
  return core.length > 10 ? `${core.slice(0, 10)}…` : core;
}

export function formatSettingValue(def: SettingField | undefined, value: unknown): string | null {
  if (!def || value === undefined || value === null) return null;
  if (def.widget === "SWITCH") return value === true ? "开启" : "关闭";
  if (def.widget === "SINGLE_CHOICE") {
    const str = String(value);
    const hit = (def.options ?? []).find((o) => o.value === str);
    return hit ? compactLabel(hit.label) : str;
  }
  if (def.widget === "MULTI_CHOICE") {
    const arr = Array.isArray(value) ? value.map(String) : [];
    if (!arr.length) return "未选";
    const labels = arr.slice(0, 3).map((v) => {
      const hit = (def.options ?? []).find((o) => o.value === v);
      return hit ? compactLabel(hit.label) : v;
    });
    return `${labels.join("、")}${arr.length > 3 ? ` 等${arr.length}项` : ""}`;
  }
  if (def.widget === "NUMBER" || def.widget === "RANGE") {
    return def.unit ? `${String(value)} ${def.unit.trim()}` : String(value);
  }
  return String(value) || null;
}

export function resolveTaskDefaults(detail: GameTask | undefined, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const schema = detail?.fieldsSchema ?? [];
  const merged: Record<string, unknown> = { ...overrides };
  for (let pass = 0; pass < 2; pass++) {
    for (const f of schema) {
      if ((merged[f.id] === undefined || merged[f.id] === null) && f.recommended !== undefined && f.recommended !== null && settingVisible(f, merged)) {
        merged[f.id] = f.recommended;
      }
    }
  }
  return merged;
}

export function summarizeWebTaskConfig(detail: GameTask | undefined, overrides: Record<string, unknown> = {}, maxChips = 3): string[] {
  const schema = detail?.fieldsSchema ?? [];
  if (!schema.length || maxChips <= 0) return [];
  const effective = resolveTaskDefaults(detail, overrides);
  const visible = schema.filter((f) => !f.readOnly && settingVisible(f, effective));
  const chips: string[] = [];
  const switches = visible.filter((f) => f.widget === "SWITCH" && f.id !== "returnHome");
  const enabledSwitches = switches.filter((f) => effective[f.id] === true);
  if (switches.length >= 3) {
    if (!enabledSwitches.length) chips.push("未勾选项");
    else {
      const preview = enabledSwitches.slice(0, 3).map((sw) => compactLabel(sw.label).replace(/^(开启|参与|领取|执行|自动)/, "").slice(0, 5)).filter(Boolean).join("·");
      chips.push(enabledSwitches.length <= 3 ? preview : `已开${enabledSwitches.length}项（${preview}）`);
    }
  }
  let presetChip: string | null = null;
  for (const f of visible) {
    if (chips.length >= maxChips) break;
    const raw = effective[f.id];
    if (raw === undefined || raw === null) continue;
    if (f.widget === "SINGLE_CHOICE") {
      const matrix = parseGroupTeamMatrix(f.options ?? []);
      if (matrix) {
        if (String(raw) !== matrix.noneOpt?.value) presetChip = `预设 ${String(raw)}`;
      } else if (switches.length < 3) {
        const txt = formatSettingValue(f, raw);
        if (txt && txt !== "不选，停下来由我处理") chips.push(txt);
      }
    } else if ((f.widget === "NUMBER" || f.widget === "RANGE") && switches.length < 3) {
      const txt = formatSettingValue(f, raw);
      if (txt) chips.push(txt);
    }
  }
  if (presetChip) {
    if (chips.length >= maxChips) chips[chips.length - 1] = presetChip;
    else chips.push(presetChip);
  }
  return chips.slice(0, maxChips);
}

export function stepWillRun(step: TaskStepDetail, values: Record<string, unknown>): boolean {
  const fid = step.conditionFieldId;
  if (!fid) return true;
  const raw = values[fid];
  if (Array.isArray(raw)) {
    const hit = step.conditionEquals != null && raw.map(String).includes(step.conditionEquals);
    return step.conditionNot ? !hit : hit;
  }
  const actual = raw === undefined || raw === null ? "false" : String(raw);
  const matched = actual === step.conditionEquals;
  return step.conditionNot ? !matched : matched;
}

/** The 步骤 tab: each step a row that opens its detail (`stepHref`). */
export function TaskStepsList({
  detail, values, stepHref,
}: {
  detail: GameTask;
  values: Record<string, unknown>;
  stepHref: (stepId: string) => string;
}) {
  const steps = detail.stepDetails ?? [];
  if (!steps.length) {
    return (
      <Card flush>
        {detail.steps.map((st, idx) => <Row key={idx}><b>{idx + 1}. {st}</b></Row>)}
      </Card>
    );
  }
  return (
    <Card flush>
      {steps.map((step) => {
        const willRun = stepWillRun(step, values);
        const provided = step.providedFieldIds?.length ?? 0;
        const summary = [
          step.conditionLabel ? `准入：${step.conditionLabel}` : null,
          provided ? `${provided} 项设置` : null,
          `${step.actionCount ?? step.actions?.length ?? 0} 个动作`,
        ].filter(Boolean).join(" · ");
        return (
          <Link key={step.id} to={stepHref(step.id)} className={`${ui.row} ${ui.rowLink}`} style={{ opacity: willRun ? 1 : 0.65 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>步骤 {step.index} · {step.name}</b>
              <span className={ui.tiny} style={{ display: "block" }}>{summary}</span>
            </span>
            <Pill tone={willRun ? "ok" : ""}>{willRun ? "● 执行" : "○ 跳过"}</Pill>
          </Link>
        );
      })}
    </Card>
  );
}

/** A task's visible settings grouped as the 参数 cards show them: by step, else by section, else one plain group. */
export interface FieldGroup { key: string; step?: TaskStepDetail; heading: string | null; fields: SettingField[] }
export function groupFields(detail: GameTask | undefined, fields: SettingField[], values: Record<string, unknown>): FieldGroup[] {
  const visible = fields.filter((def) => settingVisible(def, values));
  const stepById = new Map((detail?.stepDetails ?? []).map((st) => [st.id, st]));
  const metaById = new Map((detail?.fields ?? []).map((f) => [f.id, f]));
  const groups = new Map<string, SettingField[]>();
  for (const def of visible) {
    const sid = def.stepId ?? metaById.get(def.id)?.stepId ?? undefined;
    const key = sid && stepById.has(sid) ? `step:${sid}` : def.section ? `sec:${def.section}` : "default";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(def);
  }
  return [...groups.entries()].map(([key, list]) => {
    const step = key.startsWith("step:") ? stepById.get(key.slice(5)) : undefined;
    return { key, step, heading: step ? `步骤 ${step.index} · ${step.name}` : key.startsWith("sec:") ? key.slice(4) : null, fields: list };
  });
}

/** The 参数 tab: one card per step (grey heading「步骤 1 · 进突破 … 2 项 · 动作 ›」), each setting a row. [idOf] names each card for a jump list. */
export function StepGroupedFieldsets({
  detail, fields, values, change, stepHref, idOf,
}: {
  detail?: GameTask;
  fields: SettingField[];
  values: Record<string, unknown>;
  change: (id: string, val: unknown) => void;
  stepHref?: (stepId: string) => string;
  idOf?: (index: number) => string;
}) {
  const metaById = new Map((detail?.fields ?? []).map((f) => [f.id, f]));
  return (
    <>
      {groupFields(detail, fields, values).map(({ key: groupKey, step, heading, fields: list }, index) => {
        const count = `${list.length} 项`;
        return (
          <Card key={groupKey} flush as="section" id={idOf?.(index)} className={idOf ? s.anchored : undefined}>
            {heading && (
              <CardHead soft title={heading} aside={step && stepHref
                ? <Link to={stepHref(step.id)} className={ui.tiny} style={{ textDecoration: "none", whiteSpace: "nowrap" }}>{count} · 动作 ›</Link>
                : <span className={ui.tiny}>{count}</span>} />
            )}
            {list.map((def) => {
              const meta = metaById.get(def.id);
              const defLabel = meta?.defaultLabel ?? formatSettingValue(def, def.recommended);
              const hasRecommended = def.recommended !== undefined && def.recommended !== null;
              const same = hasRecommended && JSON.stringify(values[def.id]) === JSON.stringify(def.recommended);
              const modified = hasRecommended && values[def.id] !== undefined && !same;
              const wide = def.widget === "SINGLE_CHOICE" || def.widget === "MULTI_CHOICE";
              return (
                <div key={def.id} className={s.fieldRow} style={def.visibleWhen ? { paddingLeft: 32 } : undefined}>
                  <div className={s.fieldName}>
                    <b>{def.label}{def.required ? " *" : ""}</b>
                    {(defLabel || modified || same) && (
                      <span className={ui.tiny} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {defLabel && <span>任务默认：{defLabel}</span>}
                        {modified ? <Pill tone="info">已改</Pill> : same ? <Pill tone="soft">推荐</Pill> : null}
                      </span>
                    )}
                  </div>
                  <div className={wide ? s.fieldWide : s.fieldControl}>
                    <SettingInput def={def} value={values[def.id]} change={(val) => change(def.id, val)} />
                  </div>
                </div>
              );
            })}
          </Card>
        );
      })}
    </>
  );
}

/**
 * The account's own copy of [task]'s settings, as group cards with the bar fixed at the bottom:
 * 默认 / 保存 / ▶ 保存并开跑 ([onRun] runs it after saving).
 * [desk] is the wide layout: the bar fixed at the top after [head], a jump list of the steps on the left, and every card,
 * the steps last, on one page.
 */
export function SettingsForm({
  account, task, stepHref, onRun, runBusy, replace, desk, head,
}: {
  account: GameAccount;
  task: CloudTask;
  stepHref?: (stepId: string) => string;
  onRun?: () => void | Promise<void>;
  runBusy?: boolean;
  /** Shown instead of the settings (the 步骤 tab), keeping the unsaved edits and the bar. */
  replace?: ReactNode;
  desk?: boolean;
  head?: ReactNode;
}) {
  const { data } = useConsole();
  const detail = data.games.find((g) => g.id === task.targetId)?.tasks.find((t) => t.taskId === task.taskId);
  const [view, setView] = useState<ConfigView | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, message, run } = useAction();
  const path = `/api/accounts/${enc(account.id)}/configs/${enc(task.targetId)}/${enc(task.taskId)}`;

  useEffect(() => {
    let current = true;
    setLoadError(null); setView(null); setDirty(false);
    api<ConfigView>(path).then((loaded) => {
      if (!current) return;
      const start: Record<string, unknown> = {};
      for (const def of loaded.fields) {
        if (Object.prototype.hasOwnProperty.call(loaded.values, def.id)) start[def.id] = loaded.values[def.id];
        else if (def.recommended != null) start[def.id] = def.recommended;
      }
      setView(loaded); setValues(start); setDirty(false);
    }).catch((error: Error) => { if (current) setLoadError(error.message); });
    return () => { current = false; };
  }, [path]);

  const persist = async () => {
    if (!view) return;
    const shown = new Set(view.fields.filter((def) => settingVisible(def, values)).map((def) => def.id));
    const body = Object.fromEntries(Object.entries(values).filter(([id, value]) => value !== undefined && shown.has(id)));
    const saved = await api<ConfigView>(path, { method: "PUT", body: { values: body, revision: view.revision } });
    setView(saved); setDirty(false);
  };
  const save = () => run(persist);
  const saveAndRun = () => run(async () => { if (dirty) await persist(); await onRun?.(); });

  const recommended = (fields: SettingField[]) => {
    const defaults: Record<string, unknown> = {};
    for (const def of fields) if (def.recommended != null) defaults[def.id] = def.recommended;
    return defaults;
  };
  const hasAccountOverrides = view != null && Object.keys(view.values).length > 0;
  // 默认: with a saved copy, clear it on the server; otherwise just put the unsaved edits back.
  const resetDefaults = () => {
    if (!view) return;
    if (!hasAccountOverrides) { setValues(recommended(view.fields)); setDirty(false); return; }
    run(async () => {
      const saved = await api<ConfigView>(path, { method: "PUT", body: { values: {}, revision: view.revision } });
      setView(saved); setValues(recommended(saved.fields)); setDirty(false);
    });
  };

  const change = (id: string, value: unknown) => { setValues((now) => ({ ...now, [id]: value })); setDirty(true); };

  if (loadError) return <>{desk && <div className={s.deskBar}>{head}</div>}<Card><Empty>{loadError}</Empty></Card></>;
  if (!view) return <>{desk && <div className={s.deskBar}>{head}</div>}<Card><Empty>读取中…</Empty></Card></>;
  const status = (
    <span role="status" className={message && !message.ok ? s.statusBad : ui.tiny} style={desk ? { whiteSpace: "normal" } : { flex: 1, minWidth: 0, whiteSpace: "normal" }}>
      {message && !message.ok ? message.text : dirty ? "未保存" : ""}
    </span>
  );
  const buttons = (
    <>
      <Button small={desk} onClick={resetDefaults} disabled={busy || (!hasAccountOverrides && !dirty)}>默认</Button>
      <Button small={desk} onClick={save} disabled={busy || !dirty}>保存</Button>
    </>
  );
  if (desk) {
    const groups = groupFields(detail, view.fields, values);
    const jumps: [string, string][] = [
      ...groups.map((group, i): [string, string] => [`set-${i}`, group.step ? `${group.step.index} ${group.step.name}` : group.heading ?? "参数"]),
      ...(detail ? [["set-steps", "全部步骤"] as [string, string]] : []),
    ];
    return (
      <>
        <div className={s.deskBar}>
          {head}{status}{buttons}
          {onRun && <Button small variant="primary" onClick={saveAndRun} disabled={busy || runBusy}>▶ 保存并开跑</Button>}
        </div>
        <div className={s.deskBody}>
          <JumpList items={jumps} />
          <div className={s.stack}>
            {view.fields.length === 0
              ? <Card><Empty>没有参数</Empty></Card>
              : <StepGroupedFieldsets detail={detail} fields={view.fields} values={values} change={change} stepHref={stepHref} idOf={(i) => `set-${i}`} />}
            {detail && (
              <section id="set-steps" className={`${s.anchored} ${s.stack}`} aria-labelledby="set-steps-h">
                <h3 id="set-steps-h" className={ui.tiny} style={{ fontWeight: 600, padding: "4px 2px 0" }}>全部步骤</h3>
                <TaskStepsList detail={detail} values={values} stepHref={stepHref ?? (() => "")} />
              </section>
            )}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {replace ?? (view.fields.length === 0
        ? <Card><Empty>没有参数</Empty></Card>
        : <StepGroupedFieldsets detail={detail} fields={view.fields} values={values} change={change} stepHref={stepHref} />)}
      <FootBar>
        {buttons}
        {status}
        {onRun && <Button variant="primary" onClick={saveAndRun} disabled={busy || runBusy} style={{ flex: "1 1 160px" }}>▶ 保存并开跑</Button>}
      </FootBar>
    </>
  );
}

/**
 * Jumps within the page (锚点跳转，不切页): each item scrolls its card into view; the one at the top of the window is marked.
 */
export function JumpList({ items }: { items: [string, string][] }) {
  const [current, setCurrent] = useState(items[0]?.[0] ?? "");
  const ids = items.map(([id]) => id).join(" ");
  useEffect(() => {
    const spy = () => {
      let at = ids.split(" ")[0] ?? "";
      for (const id of ids.split(" ")) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < 140) at = id; }
      setCurrent(at);
    };
    spy();
    window.addEventListener("scroll", spy, { passive: true });
    return () => window.removeEventListener("scroll", spy);
  }, [ids]);
  if (items.length < 2) return <span />;
  return (
    <nav className={s.jumps} aria-label="步骤跳转">
      {items.map(([id, text]) => (
        <a key={id} href={`#${id}`} aria-current={id === current ? "true" : undefined} onClick={(event) => {
          event.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}>{text}</a>
      ))}
    </nav>
  );
}

type MatrixOption = { value: string; label: string };
function parseGroupTeamMatrix(options: MatrixOption[]) {
  if (options.length < 6) return null;
  let noneOpt: MatrixOption | null = null;
  const groups = new Map<string, { team: string; opt: MatrixOption }[]>();
  for (const opt of options) {
    const m = /^(\d+)-(\d+)$/.exec(opt.value);
    if (m) {
      const [, g, t] = m;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push({ team: t, opt });
    } else if (!noneOpt && (opt.value === "none" || opt.label.startsWith("不切换"))) {
      noneOpt = opt;
    } else {
      return null;
    }
  }
  if (groups.size < 2 || [...groups.values()].some((arr) => arr.length < 2)) return null;
  return { noneOpt, groups };
}

function SettingInput({ def, value, change }: { def: SettingField; value: unknown; change: (value: unknown) => void }) {
  const disabled = def.readOnly === true;
  const options = def.options ?? [];
  switch (def.widget) {
    case "SINGLE_CHOICE": {
      const matrix = parseGroupTeamMatrix(options);
      if (matrix) {
        const strVal = typeof value === "string" ? value : "";
        const m = /^(\d+)-(\d+)$/.exec(strVal);
        const activeGroup = m && matrix.groups.has(m[1]) ? m[1] : null;
        const activeTeam = m ? m[2] : null;
        const NONE = "__none__";
        const groupValue = activeGroup ?? (matrix.noneOpt != null && strVal === matrix.noneOpt.value ? NONE : null);
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Chips label={`${def.label}：分组`} disabled={disabled} value={groupValue}
              items={[...(matrix.noneOpt ? [[NONE, "不切换"] as [string, string]] : []), ...[...matrix.groups.keys()].map((g): [string, string] => [g, `分组 ${g}`])]}
              onChange={(g) => {
                if (g === NONE) { change(matrix.noneOpt!.value); return; }
                const teams = matrix.groups.get(g)!;
                change((teams.find((item) => item.team === activeTeam) ?? teams[0]).opt.value);
              }} />
            {activeGroup && (
              <Chips label={`${def.label}：队伍`} disabled={disabled} value={strVal}
                items={matrix.groups.get(activeGroup)!.map(({ team, opt }): [string, string] => [opt.value, `队伍 ${team}`])} onChange={change} />
            )}
          </div>
        );
      }
      if (options.every((option) => option.label.length <= 8)) {
        return <Chips label={def.label} disabled={disabled} value={typeof value === "string" ? value : null}
          items={options.map((option): [string, string] => [option.value, option.label])} onChange={change} />;
      }
      return (
        <div role="radiogroup" aria-label={def.label} className={s.optionGrid}>
          {options.map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={value === option.value} disabled={disabled}
              className={value === option.value ? `${s.option} ${s.optionOn}` : s.option} onClick={() => change(option.value)}>{option.label}</button>
          ))}
        </div>
      );
    }
    case "MULTI_CHOICE": {
      const chosen = new Set(Array.isArray(value) ? value as string[] : []);
      return (
        <Choices>
          {options.map((option) => <Check key={option.value} label={option.label} disabled={disabled} checked={chosen.has(option.value)}
            onChange={(on) => change(options.map((item) => item.value).filter((id) => id === option.value ? on : chosen.has(id)))} />)}
        </Choices>
      );
    }
    case "SWITCH": return <Switch label={def.label} disabled={disabled} checked={value === true} onChange={change} />;
    case "NUMBER": case "RANGE":
      return <Stepper label={def.label} disabled={disabled} min={def.minimum} max={def.maximum} step={def.step ?? 1} unit={def.unit?.trim() || undefined}
        value={typeof value === "number" ? value : undefined} onChange={change} />;
    case "TEXT": case "TIME": case "DATE":
      return <input className={s.input} aria-label={def.label} type={def.widget === "TEXT" ? "text" : def.widget.toLowerCase()} disabled={disabled}
        value={typeof value === "string" ? value : ""} onChange={(e) => change(e.target.value || undefined)} />;
    default: return <span className={ui.tiny}>在 App 里改</span>;
  }
}
