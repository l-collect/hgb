import { useState, type ReactNode } from "react";
import { api, enc } from "../../api/client";
import { settingVisible, type Game, type GameAccount, type GameTask, type Job, type Plan, type PlanSave, type PresetPlan } from "../../api/types";
import { Breadcrumb, Button, ButtonLink, Card, CardHead, Check, Empty, FootBar, PageHeader, Pill, Popover, Row, SegmentTabs, Stepper, Switch, ui } from "../../components/ui";
import { orAlert, useAction } from "../../components/useAction";
import { clockText, cycleText, jobStatus, shortTime, WEEK } from "../../format";
import { Link, navigate, paths } from "../../router";
import { useConsole } from "../../state/context";
import { NotFound } from "../ConsolePage";
import { resolveTaskDefaults, StepGroupedFieldsets, summarizeWebTaskConfig, TaskStepsList } from "./Settings";
import s from "./Accounts.module.css";

const saveOf = (plan: Plan, change: Partial<PlanSave> = {}): PlanSave => ({
  name: plan.name, days: plan.days, minuteOfDay: plan.minuteOfDay, tasks: plan.tasks, deviceIds: plan.deviceIds,
  latestStartMinutes: plan.latestStartMinutes, enabled: plan.enabled, revision: plan.revision, jitterMinutes: plan.jitterMinutes ?? 0,
  coopPartnerIds: plan.coopPartnerIds ?? [], taskConfigs: plan.taskConfigs ?? {}, ...change,
});

const presetSaveOf = (preset: PresetPlan, enabled = true): PlanSave => ({
  name: preset.name, days: preset.days, minuteOfDay: preset.minuteOfDay, tasks: preset.tasks,
  deviceIds: [], latestStartMinutes: preset.latestStartMinutes ?? 30, enabled, revision: 0, jitterMinutes: preset.jitterMinutes ?? 5,
  coopPartnerIds: [], taskConfigs: preset.taskConfigs ?? {},
});

/** 定时计划: presets and the account's own plans by time; the switch enables one (a preset is copied with its defaults). */
export function PlanList({ account, game, plans }: { account: GameAccount; game?: Game; plans: Plan[]; jobs?: Job[] }) {
  const mine = plans.filter((plan) => plan.accountId === account.id);
  const presets = game?.presetPlans ?? [];

  const unified = [
    ...mine.map((plan) => ({ key: `plan:${plan.id}`, minuteOfDay: plan.minuteOfDay, name: plan.name, plan, preset: presets.find((p) => p.name === plan.name) ?? null })),
    ...presets.filter((preset) => !mine.some((plan) => plan.name === preset.name))
      .map((preset) => ({ key: `preset:${preset.id}`, minuteOfDay: preset.minuteOfDay, name: preset.name, plan: null as Plan | null, preset })),
  ].sort((a, b) => a.minuteOfDay - b.minuteOfDay || a.name.localeCompare(b.name));

  const enabledCount = unified.filter((u) => u.plan?.enabled).length;

  return (
    <Card as="section" flush aria-label="定时计划">
      <CardHead title={<>定时计划 <span className={ui.tiny}>{enabledCount}/{unified.length} 启用</span></>}
        aside={<Button small onClick={() => navigate(paths.planNew(account.id))}>＋ 新建</Button>} />
      {unified.length === 0 ? (
        <Empty>还没有计划，点「＋ 新建」</Empty>
      ) : unified.map(({ key, plan, preset }) => {
        const enabled = plan?.enabled ?? false;
        const tasks = plan?.tasks ?? preset?.tasks ?? [];
        const source = plan ?? preset!;
        const taskNames = tasks.length <= 2
          ? tasks.map((t) => t.name).join(" · ")
          : `${tasks.slice(0, 2).map((t) => t.name).join(" · ")} 等 ${tasks.length} 项`;
        const targetHref = plan ? paths.planEdit(account.id, plan.id) : paths.presetEdit(account.id, preset!.id);
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
              onChange={(on) => {
                if (plan) {
                  orAlert(() => api(`/api/plans/${enc(plan.id)}`, { method: "PUT", body: saveOf(plan, { enabled: on }) }));
                } else if (on && preset) {
                  orAlert(() => api(`/api/accounts/${enc(account.id)}/plans`, { method: "POST", body: presetSaveOf(preset, true) }));
                }
              }}
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
 * 时间与周期 / 执行任务 / 设备与协战, with 删除 / 保存计划 at the bottom.
 */
export function PlanDetailPage({ accountId, planId, presetId }: { accountId: string; planId?: string; presetId?: string }) {
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
  return <PlanEditor account={account} game={game} plan={plan} preset={preset} />;
}

function PlanEditor({ account, game, plan, preset }: { account: GameAccount; game?: Game; plan: Plan | null; preset: PresetPlan | null }) {
  const { data } = useConsole();
  const peerAccounts = data.accounts.filter((a) => a.gameId === account.gameId && a.id !== account.id);
  const [name, setName] = useState(plan?.name ?? preset?.name ?? "");
  const [at, setAt] = useState(plan ? clockText(plan.minuteOfDay) : preset ? clockText(preset.minuteOfDay) : "08:00");
  const [late, setLate] = useState<number | undefined>(plan?.latestStartMinutes ?? preset?.latestStartMinutes ?? 30);
  const [jitter, setJitter] = useState<number | undefined>(plan?.jitterMinutes ?? preset?.jitterMinutes ?? 5);
  const enabled = plan?.enabled ?? true;
  const [days, setDays] = useState(new Set(plan?.days ?? preset?.days ?? [1, 2, 3, 4, 5, 6, 7]));
  const [selectedTasks, setSelectedTasks] = useState<string[]>((plan?.tasks ?? preset?.tasks ?? []).map((t) => t.taskId));
  const [draftConfigs, setDraftConfigs] = useState<Record<string, Record<string, unknown>>>(plan?.taskConfigs ?? preset?.taskConfigs ?? {});
  const [draftTaskId, setDraftTaskId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [where, setWhere] = useState(new Set(plan?.deviceIds ?? []));
  const [partners, setPartners] = useState(new Set(plan?.coopPartnerIds ?? []));
  const { busy, message, run } = useAction();
  const flip = <T,>(set: Set<T>, item: T, on: boolean) => { const next = new Set(set); if (on) next.add(item); else next.delete(item); return next; };
  const taskMap = new Map((game?.tasks ?? []).map((t) => [t.taskId, t]));

  // Editing a task's copy before an unsaved plan exists.
  const draftDetail = draftTaskId ? taskMap.get(draftTaskId) : undefined;
  if (!plan && draftDetail) {
    return (
      <UnsavedPlanTaskSubPage
        accountId={account.id}
        planName={name || "新建计划"}
        detail={draftDetail}
        initialValues={draftConfigs[draftDetail.taskId]}
        presetValues={preset?.taskConfigs?.[draftDetail.taskId]}
        onBack={() => setDraftTaskId(null)}
        onSave={(vals) => {
          setDraftConfigs((prev) => ({ ...prev, [draftDetail.taskId]: vals }));
          setDraftTaskId(null);
        }}
      />
    );
  }

  const submit = () => run(async () => {
    if (!name.trim()) throw new Error("先填名称");
    if (!selectedTasks.length) throw new Error("至少选一个任务");
    if (!days.size) throw new Error("至少选一天");
    const [hour, minute] = at.split(":").map(Number);
    const orderedTasks = selectedTasks.map((tid) => taskMap.get(tid)).filter((t): t is NonNullable<typeof t> => !!t)
      .map(({ targetId, taskId, name: taskName }) => ({ targetId, taskId, name: taskName }));
    const activeConfigs = plan ? (plan.taskConfigs ?? {}) : draftConfigs;
    const scopedConfigs = Object.fromEntries(Object.entries(activeConfigs).filter(([tid]) => selectedTasks.includes(tid)));
    const body: PlanSave = {
      name, days: [...days].sort(), minuteOfDay: hour * 60 + minute,
      tasks: orderedTasks,
      deviceIds: data.devices.filter((d) => where.has(d.id)).map((d) => d.id),
      latestStartMinutes: Number(late ?? 30),
      jitterMinutes: Number(jitter ?? 0),
      coopPartnerIds: peerAccounts.filter((a) => partners.has(a.id)).map((a) => a.id).slice(0, 2),
      enabled, revision: plan?.revision ?? 0,
      taskConfigs: scopedConfigs,
    };
    if (plan) await api(`/api/plans/${enc(plan.id)}`, { method: "PUT", body });
    else await api(`/api/accounts/${enc(account.id)}/plans`, { method: "POST", body });
    navigate(paths.accounts);
  });

  const remove = () => {
    if (!plan) return;
    const prompt = preset ? `重置并关闭「${plan.name}」？` : `删除「${plan.name}」？`;
    if (confirm(prompt)) orAlert(async () => { await api(`/api/plans/${enc(plan.id)}`, { method: "DELETE" }); navigate(paths.accounts); });
  };

  const last = plan ? data.jobs.find((job) => job.planId === plan.id) : undefined;
  const unpicked = (game?.tasks ?? []).filter((task) => !selectedTasks.includes(task.taskId));
  const deviceText = where.size ? data.devices.filter((d) => where.has(d.id)).map((d) => d.name).join("、") || "自动分配" : "自动分配";
  const partnerText = partners.size ? peerAccounts.filter((a) => partners.has(a.id)).map((a) => a.name).join("、") || "不带" : "不带";

  return (
    <>
      <Breadcrumb items={[["账号与计划", paths.accounts], [account.name, paths.account(account.id)], [plan?.name ?? preset?.name ?? "新建计划", null]]} />
      <PageHeader
        title={plan ? plan.name : preset ? preset.name : "新建计划"}
        aside={plan ? <Button small onClick={() => orAlert(() => api(`/api/plans/${enc(plan.id)}/run`, { method: "POST", body: {} }))}>立即运行</Button> : undefined}
      />
      {last && (
        <p className={ui.tiny} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          上次：{shortTime(last.updatedAt)}{last.deviceName ? ` · ${last.deviceName}` : ""} <Pill tone={jobStatus(last)[1]}>{jobStatus(last)[0]}</Pill>
        </p>
      )}

      <Card flush as="section">
        <CardHead title="时间与周期" />
        <Row>
          <span style={{ flex: 1 }}>名称</span>
          <input type="text" required maxLength={40} aria-label="名称" value={name} onChange={(e) => setName(e.target.value)} className={s.inlineInput} />
        </Row>
        <Row>
          <span style={{ flex: 1 }}>时间</span>
          <input type="time" required aria-label="时间" value={at} onChange={(e) => setAt(e.target.value)} className={ui.mono} />
          <Stepper label="浮动" unit="±分" min={0} max={60} value={jitter} onChange={setJitter} />
        </Row>
        <div className={s.daysRow} role="group" aria-label="星期">
          {WEEK.map((label, i) => (
            <button key={label} type="button" role="checkbox" aria-checked={days.has(i + 1)} aria-label={`周${label}`}
              className={days.has(i + 1) ? `${s.dayPick} ${s.dayOn}` : s.dayPick} onClick={() => setDays(flip(days, i + 1, !days.has(i + 1)))}>{label}</button>
          ))}
        </div>
        <Row>
          <span style={{ flex: 1 }}>补跑窗口</span>
          <Stepper label="补跑窗口" unit="分" min={1} max={1440} step={5} value={late} onChange={setLate} />
        </Row>
      </Card>

      <Card flush as="section">
        <CardHead title="执行任务" aside={<span className={ui.tiny}>{selectedTasks.length} 项</span>} />
        {selectedTasks.map((tid, idx) => {
          const task = taskMap.get(tid);
          if (!task) return null;
          const cfgSource = plan?.taskConfigs?.[tid] ?? draftConfigs[tid] ?? preset?.taskConfigs?.[tid] ?? {};
          const chips = summarizeWebTaskConfig(task, cfgSource, 3);
          return (
            <Row key={tid}>
              <span className={`${ui.tiny} ${ui.mono}`}>#{idx + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 500 }}>{task.name}</span>
                <span className={ui.tiny}>{chips.length ? chips.join(" · ") : "默认"}</span>
              </span>
              {plan
                ? <Link to={paths.planTaskConfig(account.id, plan.id, tid)} className={s.configLink}>配置 ›</Link>
                : <button type="button" className={s.configLink} onClick={() => setDraftTaskId(tid)}>配置 ›</button>}
              <Switch label={task.name} checked onChange={() => setSelectedTasks((prev) => prev.filter((id) => id !== tid))} />
            </Row>
          );
        })}
        {unpicked.length > 0 && (
          adding ? unpicked.map((task) => (
            <Row key={task.taskId}>
              <span style={{ flex: 1 }} className={ui.tiny}>{task.name}</span>
              <Button small onClick={() => setSelectedTasks((prev) => [...prev, task.taskId])}>＋ 加入</Button>
            </Row>
          )).concat(<Row key="__done"><Button variant="link" onClick={() => setAdding(false)}>收起</Button></Row>)
          : <Row><Button variant="link" onClick={() => setAdding(true)}>＋ 添加任务</Button></Row>
        )}
      </Card>

      {(data.devices.length > 0 || peerAccounts.length > 0) && (
        <Card flush as="section">
          <CardHead title="设备与协战" />
          {data.devices.length > 0 && (
            <PickRow label="设备" text={deviceText}>
              {data.devices.map((device) => <Check key={device.id} label={device.name} checked={where.has(device.id)} onChange={(on) => setWhere(flip(where, device.id, on))} />)}
            </PickRow>
          )}
          {peerAccounts.length > 0 && (
            <PickRow label="协战（最多 2 个）" text={partnerText}>
              {peerAccounts.map((peer) => <Check key={peer.id} label={peer.nickname ? `${peer.name} · ${peer.nickname}` : peer.name} checked={partners.has(peer.id)}
                onChange={(on) => { if (!on || partners.size < 2) setPartners(flip(partners, peer.id, on)); }} />)}
            </PickRow>
          )}
        </Card>
      )}

      <FootBar>
        {plan && <Button variant="danger" onClick={remove}>{preset ? "重置" : "删除"}</Button>}
        <span role="status" className={s.statusBad} style={{ flex: 1, minWidth: 0, whiteSpace: "normal", fontSize: 13 }}>{message && !message.ok ? message.text : ""}</span>
        <Button variant="primary" onClick={submit} disabled={busy} style={{ flex: "1 1 160px" }}>保存计划</Button>
      </FootBar>
    </>
  );
}

function UnsavedPlanTaskSubPage({
  accountId, planName, detail, initialValues, presetValues, onBack, onSave,
}: {
  accountId: string;
  planName: string;
  detail: NonNullable<Game["tasks"][number]>;
  initialValues?: Record<string, unknown>;
  presetValues?: Record<string, unknown>;
  onBack: () => void;
  onSave: (vals: Record<string, unknown>) => void;
}) {
  const fields = detail.fieldsSchema ?? [];
  const defaults = resolveTaskDefaults(detail, presetValues ?? {});
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValues && Object.keys(initialValues).length > 0 ? resolveTaskDefaults(detail, initialValues) : defaults,
  );
  const [tab, setTab] = useState<"config" | "steps">("config");
  const stepHref = (sid: string) => paths.taskStep(detail.targetId, detail.taskId, sid, { accountId });

  return (
    <>
      <PageHeader title={detail.name} subtitle={planName} />
      <SegmentTabs label="任务内容" value={tab} onChange={setTab}
        items={[["config", `参数（${fields.length}）`], ["steps", `步骤（${detail.stepDetails?.length ?? detail.steps.length}）`]]} />
      {tab === "steps" ? <TaskStepsList detail={detail} values={values} stepHref={stepHref} />
        : fields.length === 0 ? <Card><Empty>没有参数</Empty></Card>
        : <StepGroupedFieldsets detail={detail} fields={fields} values={values} change={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))} stepHref={stepHref} />}
      <FootBar>
        <Button onClick={() => setValues(defaults)}>默认</Button>
        <Button onClick={onBack}>返回</Button>
        <span style={{ flex: 1 }} />
        <Button variant="primary" style={{ flex: "1 1 160px" }} onClick={() => {
          const shown = new Set(fields.filter((def) => settingVisible(def, values)).map((def) => def.id));
          onSave(Object.fromEntries(Object.entries(values).filter(([id, val]) => val !== undefined && shown.has(id))));
        }}>确定</Button>
      </FootBar>
    </>
  );
}

/** Level-3 (`/accounts/:id/plans/:planId/tasks/:taskId`): this plan's own copy of a task's settings. */
export function PlanTaskConfigPage({ accountId, planId, taskId }: { accountId: string; planId: string; taskId: string }) {
  const { data } = useConsole();
  const account = data.accounts.find((a) => a.id === accountId);
  const plan = data.plans.find((p) => p.id === planId && p.accountId === accountId);
  if (!account || !plan) return <NotFound text="没有这个计划" back={paths.accounts} backText="回到账号" />;
  const game = data.games.find((g) => g.id === account.gameId);
  const detail = game?.tasks.find((t) => t.taskId === taskId);
  if (!detail) return <NotFound text="没有这个任务" back={paths.planEdit(account.id, plan.id)} backText="回到计划" />;
  return <PlanTaskConfig account={account} plan={plan} detail={detail} preset={game?.presetPlans?.find((p) => p.name === plan.name)} />;
}

function PlanTaskConfig({ account, plan, detail, preset }: { account: GameAccount; plan: Plan; detail: GameTask; preset?: PresetPlan }) {
  const taskId = detail.taskId;
  const fields = detail.fieldsSchema ?? [];
  const defaults = resolveTaskDefaults(detail, preset?.taskConfigs?.[taskId] ?? {});
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const existing = plan.taskConfigs?.[taskId];
    return existing && Object.keys(existing).length > 0 ? resolveTaskDefaults(detail, existing) : defaults;
  });
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"config" | "steps">("config");
  const { busy, message, run } = useAction();

  const save = () => run(async () => {
    const shown = new Set(fields.filter((def) => settingVisible(def, values)).map((def) => def.id));
    const cleaned = Object.fromEntries(Object.entries(values).filter(([id, val]) => val !== undefined && shown.has(id)));
    const nextMap = { ...(plan.taskConfigs ?? {}), [taskId]: cleaned };
    await api(`/api/plans/${enc(plan.id)}`, { method: "PUT", body: saveOf(plan, { taskConfigs: nextMap }) });
    setDirty(false);
    navigate(paths.planEdit(account.id, plan.id));
  });

  const stepUrl = (stepId: string) => paths.taskStep(detail.targetId, detail.taskId, stepId, { accountId: account.id, planId: plan.id });

  return (
    <>
      <Breadcrumb items={[["账号与计划", paths.accounts], [plan.name, paths.planEdit(account.id, plan.id)], [detail.name, null]]} />
      <PageHeader title={detail.name} subtitle={plan.name} />
      <SegmentTabs label="任务内容" value={tab} onChange={setTab}
        items={[["config", `参数（${fields.length}）`], ["steps", `步骤（${detail.stepDetails?.length ?? detail.steps.length}）`]]} />
      {tab === "steps" ? <TaskStepsList detail={detail} values={values} stepHref={stepUrl} />
        : fields.length === 0 ? <Card><Empty>没有参数</Empty></Card>
        : <StepGroupedFieldsets detail={detail} fields={fields} values={values} change={(id, next) => { setValues((prev) => ({ ...prev, [id]: next })); setDirty(true); }} stepHref={stepUrl} />}
      <FootBar>
        <Button onClick={() => { setValues(defaults); setDirty(true); }} disabled={busy}>默认</Button>
        <ButtonLink to={paths.planEdit(account.id, plan.id)}>取消</ButtonLink>
        <span role="status" className={message && !message.ok ? s.statusBad : ui.tiny} style={{ flex: 1, minWidth: 0, whiteSpace: "normal" }}>
          {message && !message.ok ? message.text : dirty ? "未保存" : ""}
        </span>
        <Button variant="primary" onClick={save} disabled={busy || !dirty} style={{ flex: "1 1 160px" }}>保存</Button>
      </FootBar>
    </>
  );
}
