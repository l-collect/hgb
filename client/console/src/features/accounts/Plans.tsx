import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, enc } from "../../api/client";
import { settingVisible, type ConfigView, type Game, type GameAccount, type GameTask, type Job, type Plan, type PlanSave, type PresetPlan } from "../../api/types";
import { Breadcrumb, Button, Card, CardHead, Check, Empty, FootBar, PageHeader, Pill, Popover, Row, SegmentTabs, Stepper, Switch, ui } from "../../components/ui";
import { ask } from "../../components/Confirm";
import { orAlert, useAction } from "../../components/useAction";
import { clockText, cycleText, jobStatus, shortTime, WEEK } from "../../format";
import { leave, Link, navigate, paths, useLeaveGuard } from "../../router";
import { useConsole } from "../../state/context";
import { NotFound } from "../ConsolePage";
import { formatSettingValue, resolveTaskDefaults, StepGroupedFieldsets, TaskStepsList } from "./Settings";
import { DrawerBody, DrawerField, DrawerFoot, DrawerGrid, DrawerHead, drawerStyles } from "../../components/Drawer";
import s from "./Accounts.module.css";

export const saveOf = (plan: Plan, change: Partial<PlanSave> = {}): PlanSave => ({
  name: plan.name, days: plan.days, minuteOfDay: plan.minuteOfDay, tasks: plan.tasks, deviceIds: plan.deviceIds,
  latestStartMinutes: plan.latestStartMinutes, enabled: plan.enabled, revision: plan.revision, jitterMinutes: plan.jitterMinutes ?? 0,
  coopPartnerIds: plan.coopPartnerIds ?? [], taskConfigs: plan.taskConfigs ?? {}, ...change,
});

const presetSaveOf = (preset: PresetPlan, enabled = true): PlanSave => ({
  name: preset.name, days: preset.days, minuteOfDay: preset.minuteOfDay, tasks: preset.tasks,
  deviceIds: [], latestStartMinutes: preset.latestStartMinutes ?? 30, enabled, revision: 0, jitterMinutes: preset.jitterMinutes ?? 5,
  coopPartnerIds: [], taskConfigs: preset.taskConfigs ?? {},
});

/** One line of 定时计划: the account's own plan, or a preset not yet copied (plan null). */
export interface PlanEntry { key: string; minuteOfDay: number; name: string; plan: Plan | null; preset: PresetPlan | null }
/** The account's plans and the presets it has not copied, by time. */
export function planEntries(account: GameAccount, game: Game | undefined, plans: Plan[]): PlanEntry[] {
  const mine = plans.filter((plan) => plan.accountId === account.id);
  const presets = game?.presetPlans ?? [];
  return [
    ...mine.map((plan) => ({ key: `plan:${plan.id}`, minuteOfDay: plan.minuteOfDay, name: plan.name, plan, preset: presets.find((p) => p.name === plan.name) ?? null })),
    ...presets.filter((preset) => !mine.some((plan) => plan.name === preset.name))
      .map((preset) => ({ key: `preset:${preset.id}`, minuteOfDay: preset.minuteOfDay, name: preset.name, plan: null as Plan | null, preset })),
  ].sort((a, b) => a.minuteOfDay - b.minuteOfDay || a.name.localeCompare(b.name));
}
/** The switch of a plan line: a plan is saved with the new state; a preset is copied, enabled, the first time it is switched on. */
export function switchPlan(account: GameAccount, { plan, preset }: PlanEntry, on: boolean) {
  if (plan) orAlert(() => api(`/api/plans/${enc(plan.id)}`, { method: "PUT", body: saveOf(plan, { enabled: on }) }));
  else if (on && preset) orAlert(() => api(`/api/accounts/${enc(account.id)}/plans`, { method: "POST", body: presetSaveOf(preset, true) }));
}
export const planHref = (account: GameAccount, { plan, preset }: PlanEntry) => plan ? paths.planEdit(account.id, plan.id) : paths.presetEdit(account.id, preset!.id);

/** 定时计划: presets and the account's own plans by time; the switch enables one (a preset is copied with its defaults). */
export function PlanList({ account, game, plans }: { account: GameAccount; game?: Game; plans: Plan[]; jobs?: Job[] }) {
  const unified = planEntries(account, game, plans);

  const enabledCount = unified.filter((u) => u.plan?.enabled).length;

  return (
    <Card as="section" flush aria-label="定时计划">
      <CardHead title={<>定时计划 <span className={ui.tiny}>{enabledCount}/{unified.length} 启用</span></>}
        aside={<Button small onClick={() => navigate(paths.planNew(account.id))}>＋ 新建</Button>} />
      {unified.length === 0 ? (
        <Empty>还没有计划，点「＋ 新建」</Empty>
      ) : unified.map((entry) => {
        const { key, plan, preset } = entry;
        const enabled = plan?.enabled ?? false;
        const tasks = plan?.tasks ?? preset?.tasks ?? [];
        const source = plan ?? preset!;
        const taskNames = tasks.length <= 2
          ? tasks.map((t) => t.name).join(" · ")
          : `${tasks.slice(0, 2).map((t) => t.name).join(" · ")} 等 ${tasks.length} 项`;
        const targetHref = planHref(account, entry);
        return (
          <div key={key} className={s.planRow}>
            <Link to={targetHref} className={s.planLink}>
              <span className={s.planTime}>
                <b className={ui.mono}>{clockText(source.minuteOfDay)}</b>
                <span className={ui.tiny}>{cycleText(source.days, source.jitterMinutes)}</span>
              </span>
              <span className={s.planMain}>
                <span className={s.planName}><b>{source.name}</b>{!preset && <Pill>自建</Pill>}</span>
                <span className={`${ui.tiny} ${s.ellipsis}`}>{taskNames || "未选任务"}</span>
              </span>
            </Link>
            <Switch
              label={`启用${source.name}`}
              checked={enabled}
              onChange={(on) => switchPlan(account, entry, on)}
            />
          </div>
        );
      })}
    </Card>
  );
}

/** A multi-pick shown as its value and ›, opening the choices as check rows. */
function PickRow({ label, text, children }: { label: string; text: string; children: ReactNode }) {
  return (
    <Row>
      <span style={{ flex: 1 }}>{label}</span>
      <Popover label={label} plain align="end" trigger={<span className={s.pickValue}>{text} ›</span>}>
        {() => <div className={s.pickPanel}>{children}</div>}
      </Popover>
    </Row>
  );
}

/**
 * Level-2 (`/accounts/:id/plans/new` | `/accounts/:id/plans/:planId` | `/accounts/:id/presets/:presetId`):
 * 时间与周期 / 执行任务 / 设备与协战, with 删除 / 保存计划 at the bottom. [taskId] (`…/plans/:planId/tasks/:taskId`)
 * opens with that task's settings shown.
 */
export function PlanDetailPage({ accountId, planId, presetId, taskId, drawer }: { accountId: string; planId?: string; presetId?: string; taskId?: string; drawer?: boolean }) {
  const { data } = useConsole();
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return <NotFound text="没有这个账号" back={paths.accounts} backText="回到账号" />;
  const game = data.games.find((g) => g.id === account.gameId);
  const plan = planId ? data.plans.find((p) => p.id === planId && p.accountId === account.id) ?? null : null;
  if (planId && !plan) return <NotFound text="没有这个计划" back={paths.accounts} backText="回到账号" />;
  const preset = presetId
    ? game?.presetPlans?.find((p) => p.id === presetId) ?? null
    : plan ? game?.presetPlans?.find((p) => p.name === plan.name) ?? null : null;
  if (presetId && !preset) return <NotFound text="没有这个预设" back={paths.accounts} backText="回到账号" />;
  return <PlanEditor account={account} game={game} plan={plan} preset={preset} drawer={drawer} openTask={taskId} />;
}

/** Level-3 (`/accounts/:id/plans/:planId/tasks/:taskId`): the plan's editor, opened on that task's settings. */
export function PlanTaskConfigPage({ accountId, planId, taskId, drawer }: { accountId: string; planId: string; taskId: string; drawer?: boolean }) {
  return <PlanDetailPage accountId={accountId} planId={planId} taskId={taskId} drawer={drawer} />;
}

type Configs = Record<string, Record<string, unknown>>;
/** Everything the editor changes, kept as one value so it can be compared with what was loaded. */
interface PlanForm {
  name: string; at: string; late: number | undefined; jitter: number | undefined; days: number[]; tasks: string[];
  configs: Configs; where: string[]; partners: string[];
}
const formOf = (plan: Plan | null, preset: PresetPlan | null): PlanForm => ({
  name: plan?.name ?? preset?.name ?? "",
  at: plan ? clockText(plan.minuteOfDay) : preset ? clockText(preset.minuteOfDay) : "08:00",
  late: plan?.latestStartMinutes ?? preset?.latestStartMinutes ?? 30,
  jitter: plan?.jitterMinutes ?? preset?.jitterMinutes ?? 5,
  days: plan?.days ?? preset?.days ?? [1, 2, 3, 4, 5, 6, 7],
  tasks: (plan?.tasks ?? preset?.tasks ?? []).map((t) => t.taskId),
  configs: plan?.taskConfigs ?? preset?.taskConfigs ?? {},
  where: plan?.deviceIds ?? [],
  partners: plan?.coopPartnerIds ?? [],
});
const formKey = (form: PlanForm) => JSON.stringify({
  ...form, days: [...form.days].sort(), where: [...form.where].sort(), partners: [...form.partners].sort(),
  configs: Object.fromEntries(Object.entries(form.configs).filter(([tid, values]) => form.tasks.includes(tid) && Object.keys(values).length > 0).sort(([a], [b]) => a.localeCompare(b))),
});
const hasOwn = (values: Record<string, unknown> | undefined) => !!values && Object.keys(values).length > 0;
/** The values a plan changed, as a short line: 阵容 1-2 · 退四打九 关闭. */
function ownText(detail: GameTask, values: Record<string, unknown>): string {
  const schema = new Map((detail.fieldsSchema ?? []).map((def) => [def.id, def]));
  const parts = Object.entries(values).map(([id, value]) => {
    const def = schema.get(id);
    const text = formatSettingValue(def, value);
    return def && text ? `${def.label} ${text}` : null;
  }).filter(Boolean);
  return parts.length > 2 ? `${parts.slice(0, 2).join(" · ")} 等 ${parts.length} 项` : parts.join(" · ");
}

/**
 * [drawer]: laid out for the right-hand drawer of a wide window (fields in two columns, the bar fixed at its bottom).
 * A task's settings open inside the editor and come back into it: nothing is saved until 保存计划, and leaving with
 * changes asks first.
 */
function PlanEditor({ account, game, plan, preset, drawer, openTask }: { account: GameAccount; game?: Game; plan: Plan | null; preset: PresetPlan | null; drawer?: boolean; openTask?: string }) {
  const { data } = useConsole();
  const peerAccounts = data.accounts.filter((a) => a.gameId === account.gameId && a.id !== account.id);
  const [loaded, setLoaded] = useState(() => ({ form: formOf(plan, preset), revision: plan?.revision ?? 0 }));
  const [form, setForm] = useState(loaded.form);
  const change = (next: Partial<PlanForm>) => setForm((now) => ({ ...now, ...next }));
  const [stale, setStale] = useState(false);
  const [editingTask, setEditingTask] = useState<string | null>(openTask ?? null);
  const [adding, setAdding] = useState(false);
  const { busy, message, run } = useAction();
  const saving = useRef(false);
  const enabled = plan?.enabled ?? true;
  const dirty = formKey(form) !== formKey(loaded.form);
  useLeaveGuard(dirty);
  const flip = <T,>(list: T[], item: T, on: boolean) => on ? (list.includes(item) ? list : [...list, item]) : list.filter((x) => x !== item);
  const taskMap = new Map((game?.tasks ?? []).map((t) => [t.taskId, t]));

  // Saved somewhere else meanwhile: an untouched editor takes the new version, an edited one offers it.
  const reload = () => { const next = { form: formOf(plan, preset), revision: plan?.revision ?? 0 }; setLoaded(next); setForm(next.form); setStale(false); };
  useEffect(() => {
    if (!plan || plan.revision === loaded.revision || saving.current) return;
    if (dirty) setStale(true); else reload();
  }, [plan?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => navigate(paths.accounts);
  const submit = () => run(async () => {
    if (!form.name.trim()) throw new Error("先填名称");
    if (!form.tasks.length) throw new Error("至少选一个任务");
    if (!form.days.length) throw new Error("至少选一天");
    const [hour, minute] = form.at.split(":").map(Number);
    const orderedTasks = form.tasks.map((tid) => taskMap.get(tid)).filter((t): t is NonNullable<typeof t> => !!t)
      .map(({ targetId, taskId, name: taskName }) => ({ targetId, taskId, name: taskName }));
    const body: PlanSave = {
      name: form.name, days: [...form.days].sort(), minuteOfDay: hour * 60 + minute,
      tasks: orderedTasks,
      deviceIds: data.devices.filter((d) => form.where.includes(d.id)).map((d) => d.id),
      latestStartMinutes: Number(form.late ?? 30),
      jitterMinutes: Number(form.jitter ?? 0),
      coopPartnerIds: peerAccounts.filter((a) => form.partners.includes(a.id)).map((a) => a.id).slice(0, 2),
      enabled, revision: plan?.revision ?? 0,
      // Only what the plan changed; a task left out follows the account.
      taskConfigs: Object.fromEntries(Object.entries(form.configs).filter(([tid, values]) => form.tasks.includes(tid) && hasOwn(values))),
    };
    saving.current = true;
    try {
      if (plan) await api(`/api/plans/${enc(plan.id)}`, { method: "PUT", body });
      else await api(`/api/accounts/${enc(account.id)}/plans`, { method: "POST", body });
    } finally { saving.current = false; }
    navigate(paths.accounts, { force: true });
  });

  const remove = () => {
    if (!plan) return;
    void ask(preset ? { title: `重置「${plan.name}」？`, body: "恢复预设并关闭", ok: "重置", danger: true } : { title: `删除「${plan.name}」？`, ok: "删除", danger: true })
      .then((yes) => { if (yes) orAlert(async () => { await api(`/api/plans/${enc(plan.id)}`, { method: "DELETE" }); navigate(paths.accounts, { force: true }); }); });
  };

  const staleLine = stale && (
    <p className={s.staleLine} role="status">已在别处更新 · <button type="button" className={s.configLink} onClick={reload}>载入</button></p>
  );

  const editing = editingTask ? taskMap.get(editingTask) : undefined;
  if (editing) {
    return (
      <PlanTaskEditor key={editing.taskId} account={account} plan={plan} detail={editing} planName={form.name || "新建计划"} drawer={drawer}
        own={form.configs[editing.taskId]} close={close}
        back={() => setEditingTask(null)}
        done={(own) => {
          const configs = { ...form.configs };
          if (hasOwn(own)) configs[editing.taskId] = own; else delete configs[editing.taskId];
          change({ configs }); setEditingTask(null);
        }} />
    );
  }

  const follow = (tid: string) => { const configs = { ...form.configs }; delete configs[tid]; change({ configs }); };
  const last = plan ? data.jobs.find((job) => job.planId === plan.id) : undefined;
  const unpicked = (game?.tasks ?? []).filter((task) => !form.tasks.includes(task.taskId));
  const deviceText = form.where.length ? data.devices.filter((d) => form.where.includes(d.id)).map((d) => d.name).join("、") || "自动分配" : "自动分配";
  const partnerText = form.partners.length ? peerAccounts.filter((a) => form.partners.includes(a.id)).map((a) => a.name).join("、") || "不带" : "不带";

  const title = plan ? plan.name : preset ? preset.name : "新建计划";
  const runNow = plan ? <Button small onClick={() => orAlert(() => api(`/api/plans/${enc(plan.id)}/run`, { method: "POST", body: {} }))}>立即运行</Button> : undefined;
  const lastLine = last && (
    <p className={ui.tiny} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      上次：{shortTime(last.updatedAt)}{last.deviceName ? ` · ${last.deviceName}` : ""} <Pill tone={jobStatus(last)[1]}>{jobStatus(last)[0]}</Pill>
    </p>
  );
  const dayPicks = (
    <div className={s.daysRow} role="group" aria-label="星期">
      {WEEK.map((label, i) => (
        <button key={label} type="button" role="checkbox" aria-checked={form.days.includes(i + 1)} aria-label={`周${label}`}
          className={form.days.includes(i + 1) ? `${s.dayPick} ${s.dayOn}` : s.dayPick} onClick={() => change({ days: flip(form.days, i + 1, !form.days.includes(i + 1)) })}>{label}</button>
      ))}
    </div>
  );
  const tasksCard = (
    <Card flush as="section">
    <CardHead title="执行任务" aside={<span className={ui.tiny}>{form.tasks.length} 项</span>} />
    {form.tasks.map((tid, idx) => {
      const task = taskMap.get(tid);
      if (!task) return null;
      const own = form.configs[tid];
      return (
        <Row key={tid}>
          <span className={`${ui.tiny} ${ui.mono}`}>#{idx + 1}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 500 }}>{task.name}</span>
            {hasOwn(own) ? (
              <span className={s.followLine}>
                <Pill tone="info">单独设置</Pill>
                <span className={`${ui.tiny} ${s.ellipsis}`}>{ownText(task, own)}</span>
                <button type="button" className={s.configLink} onClick={() => follow(tid)}>恢复跟随</button>
              </span>
            ) : <span className={s.followLine}><Pill tone="soft">跟随账号</Pill></span>}
          </span>
          <button type="button" className={s.configLink} onClick={() => setEditingTask(tid)}>配置 ›</button>
          <Switch label={task.name} checked onChange={() => change({ tasks: form.tasks.filter((id) => id !== tid) })} />
        </Row>
      );
    })}
    {unpicked.length > 0 && (
      adding ? unpicked.map((task) => (
        <Row key={task.taskId}>
          <span style={{ flex: 1 }} className={ui.tiny}>{task.name}</span>
          <Button small onClick={() => change({ tasks: [...form.tasks, task.taskId] })}>＋ 加入</Button>
        </Row>
      )).concat(<Row key="__done"><Button variant="link" onClick={() => setAdding(false)}>收起</Button></Row>)
      : <Row><Button variant="link" onClick={() => setAdding(true)}>＋ 添加任务</Button></Row>
    )}
  </Card>
  );
  const deviceChecks = data.devices.map((device) => <Check key={device.id} label={device.name} checked={form.where.includes(device.id)} onChange={(on) => change({ where: flip(form.where, device.id, on) })} />);
  const partnerChecks = peerAccounts.map((peer) => <Check key={peer.id} label={peer.nickname ? `${peer.name} · ${peer.nickname}` : peer.name} checked={form.partners.includes(peer.id)}
    onChange={(on) => { if (!on || form.partners.length < 2) change({ partners: flip(form.partners, peer.id, on) }); }} />);
  const status = (
    <span role="status" className={message && !message.ok ? s.statusBad : ui.tiny} style={{ flex: 1, minWidth: 0, whiteSpace: "normal", fontSize: 13 }}>
      {message && !message.ok ? message.text : dirty ? "未保存" : ""}
    </span>
  );

  if (drawer) {
    const pick = (label: string, text: string, checks: ReactNode) => (
      <DrawerField label={label}>
        <div className={drawerStyles.pick}>
          <Popover label={label} plain trigger={<span className={drawerStyles.select}><span>{text}</span><span aria-hidden="true">▾</span></span>}>
            {() => <div className={s.pickPanel}>{checks}</div>}
          </Popover>
        </div>
      </DrawerField>
    );
    return (
      <>
        <DrawerHead title={title} aside={runNow} onClose={close} />
        <DrawerBody>
          {staleLine}
          {lastLine}
          <DrawerGrid>
            <DrawerField label="名称"><input type="text" required maxLength={40} aria-label="名称" value={form.name} onChange={(e) => change({ name: e.target.value })} /></DrawerField>
            <DrawerField label="时间"><input type="time" required aria-label="时间" value={form.at} onChange={(e) => change({ at: e.target.value })} className={ui.mono} /></DrawerField>
            <DrawerField label="浮动"><Stepper label="浮动" unit="±分" min={0} max={60} value={form.jitter} onChange={(jitter) => change({ jitter })} /></DrawerField>
            <DrawerField label="补跑窗口"><Stepper label="补跑窗口" unit="分" min={1} max={1440} step={5} value={form.late} onChange={(late) => change({ late })} /></DrawerField>
            <DrawerField label="周期" wide>{dayPicks}</DrawerField>
          </DrawerGrid>
          {tasksCard}
          {(data.devices.length > 0 || peerAccounts.length > 0) && (
            <DrawerGrid>
              {data.devices.length > 0 && pick("设备", deviceText, deviceChecks)}
              {peerAccounts.length > 0 && pick("协战（最多 2 个）", partnerText, partnerChecks)}
            </DrawerGrid>
          )}
        </DrawerBody>
        <DrawerFoot>
          {plan && <Button variant="danger" onClick={remove}>{preset ? "重置" : "删除"}</Button>}
          {status}
          <Button onClick={close}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>保存计划</Button>
        </DrawerFoot>
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={[["账号与计划", paths.accounts], [account.name, paths.account(account.id)], [plan?.name ?? preset?.name ?? "新建计划", null]]} />
      <PageHeader title={title} aside={runNow} />
      {staleLine}
      {lastLine}

      <Card flush as="section">
        <CardHead title="时间与周期" />
        <Row>
          <span style={{ flex: 1 }}>名称</span>
          <input type="text" required maxLength={40} aria-label="名称" value={form.name} onChange={(e) => change({ name: e.target.value })} className={s.inlineInput} />
        </Row>
        <Row>
          <span style={{ flex: 1 }}>时间</span>
          <input type="time" required aria-label="时间" value={form.at} onChange={(e) => change({ at: e.target.value })} className={ui.mono} />
          <Stepper label="浮动" unit="±分" min={0} max={60} value={form.jitter} onChange={(jitter) => change({ jitter })} />
        </Row>
        {dayPicks}
        <Row>
          <span style={{ flex: 1 }}>补跑窗口</span>
          <Stepper label="补跑窗口" unit="分" min={1} max={1440} step={5} value={form.late} onChange={(late) => change({ late })} />
        </Row>
      </Card>

      {tasksCard}

      {(data.devices.length > 0 || peerAccounts.length > 0) && (
        <Card flush as="section">
          <CardHead title="设备与协战" />
          {data.devices.length > 0 && (
            <PickRow label="设备" text={deviceText}>{deviceChecks}</PickRow>
          )}
          {peerAccounts.length > 0 && (
            <PickRow label="协战（最多 2 个）" text={partnerText}>{partnerChecks}</PickRow>
          )}
        </Card>
      )}

      <FootBar>
        {plan && <Button variant="danger" onClick={remove}>{preset ? "重置" : "删除"}</Button>}
        {status}
        <Button variant="primary" onClick={submit} disabled={busy} style={{ flex: "1 1 160px" }}>保存计划</Button>
      </FootBar>
    </>
  );
}

/**
 * One task's settings inside the plan editor. It starts from the account's settings (task default ⊕ the account's saved
 * values) with the plan's own changes on top; 确定 keeps only what differs from the account as the plan's own, and
 * 跟随账号 puts the account's values back. Nothing is saved here: 保存计划 does it.
 */
function PlanTaskEditor({ account, plan, detail, planName, own, drawer, back, done, close }: {
  account: GameAccount; plan: Plan | null; detail: GameTask; planName: string; own?: Record<string, unknown>; drawer?: boolean;
  back: () => void; done: (own: Record<string, unknown>) => void; close: () => void;
}) {
  const fields = detail.fieldsSchema ?? [];
  const [accountValues, setAccountValues] = useState<Record<string, unknown> | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [start, setStart] = useState("");
  const [tab, setTab] = useState<"config" | "steps">("config");
  useEffect(() => {
    let alive = true;
    const begin = (saved: Record<string, unknown>) => {
      if (!alive) return;
      const first = resolveTaskDefaults(detail, { ...saved, ...(own ?? {}) });
      setAccountValues(saved); setValues(first); setStart(JSON.stringify(first));
    };
    api<ConfigView>(`/api/accounts/${enc(account.id)}/configs/${enc(detail.targetId)}/${enc(detail.taskId)}`).then((cfg) => begin(cfg.values)).catch(() => begin({}));
    return () => { alive = false; };
  }, [account.id, detail.targetId, detail.taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = accountValues !== null && JSON.stringify(values) !== start;
  useLeaveGuard(dirty);
  const base = resolveTaskDefaults(detail, accountValues ?? {});
  const differs = (shown: Record<string, unknown>) => {
    const visible = new Set(fields.filter((def) => settingVisible(def, shown)).map((def) => def.id));
    return Object.fromEntries(Object.entries(shown).filter(([id, value]) => value !== undefined && visible.has(id) && JSON.stringify(value) !== JSON.stringify(base[id])));
  };
  const following = accountValues !== null && !hasOwn(differs(values));
  const stepHref = (sid: string) => paths.taskStep(detail.targetId, detail.taskId, sid, plan ? { accountId: account.id, planId: plan.id } : { accountId: account.id });
  const goBack = () => leave(back, dirty);

  const state = accountValues !== null && (
    <p className={s.followLine}>
      {following ? <Pill tone="soft">跟随账号</Pill> : <Pill tone="info">单独设置</Pill>}
      <span className={ui.tiny}>{following ? "账号参数改了，这里跟着变" : "只在这个计划里生效"}</span>
    </p>
  );
  const content = accountValues === null ? <Card><Empty>读取中…</Empty></Card> : (
    <>
      <SegmentTabs label="任务内容" value={tab} onChange={setTab}
        items={[["config", `参数（${fields.length}）`], ["steps", `步骤（${detail.stepDetails?.length ?? detail.steps.length}）`]]} />
      {tab === "steps" ? <TaskStepsList detail={detail} values={values} stepHref={stepHref} />
        : fields.length === 0 ? <Card><Empty>没有参数</Empty></Card>
        : <StepGroupedFieldsets detail={detail} fields={fields} values={values} change={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))} stepHref={stepHref} />}
    </>
  );
  const buttons = (
    <>
      <Button onClick={() => setValues(base)} disabled={accountValues === null || following}>跟随账号</Button>
      <span style={{ flex: 1 }} />
      <Button onClick={goBack}>返回</Button>
      <Button variant="primary" disabled={accountValues === null} onClick={() => done(differs(values))} style={drawer ? undefined : { flex: "1 1 120px" }}>确定</Button>
    </>
  );
  const crumb = <button type="button" className={s.backLink} onClick={goBack}>‹ {planName}</button>;
  if (drawer) {
    return (
      <>
        <DrawerHead title={detail.name} onClose={close} />
        <DrawerBody>{crumb}{state}{content}</DrawerBody>
        <DrawerFoot>{buttons}</DrawerFoot>
      </>
    );
  }
  return (
    <>
      {crumb}
      <PageHeader title={detail.name} subtitle={planName} />
      {state}
      {content}
      <FootBar>{buttons}</FootBar>
    </>
  );
}
