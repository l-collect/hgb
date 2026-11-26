import { useEffect, useState } from "react";
import { api, enc } from "../../api/client";
import type { CloudTask, ConfigView, Game, GameAccount, GameTask, Job } from "../../api/types";
import { Breadcrumb, Button, ButtonLink, Card, CardHead, Empty, PageHeader, Pill, Row, Segments, SegmentTabs, TextSelect, ui } from "../../components/ui";
import { actionKind, ACTIVE, jobStatus, type Tone } from "../../format";
import { leave, Link, navigate, paths, useQuery } from "../../router";
import { useConsole } from "../../state/context";
import { NotFound } from "../ConsolePage";
import { formatSettingValue, resolveTaskDefaults, SettingsForm, stepWillRun, summarizeWebTaskConfig, TaskStepsList } from "../accounts/Settings";
import { Note, useRunNow } from "../jobs/runs";
import s from "./Library.module.css";

/** 常用: starred tasks, kept in this browser (the App keeps its own). */
const FAVORITES = "hgb.tasks.favorites";
const readFavorites = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(FAVORITES) ?? "[]") as string[]); } catch { return new Set(); } };
export function useFavorites(): [Set<string>, (key: string) => void] {
  const [items, setItems] = useState(readFavorites);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === FAVORITES) setItems(readFavorites()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const toggle = (key: string) => {
    const next = new Set(items); if (next.has(key)) next.delete(key); else next.add(key);
    setItems(next);
    try { localStorage.setItem(FAVORITES, JSON.stringify([...next])); } catch { /* kept for this page only */ }
  };
  return [items, toggle];
}
export const favKey = (targetId: string, taskId: string) => `${targetId}:${taskId}`;

export function StarButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  return <button type="button" className={s.star} aria-pressed={on} aria-label={on ? "移出常用" : "加入常用"} title={on ? "移出常用" : "加入常用"} onClick={toggle}>★</button>;
}

/** A task's live state for an account, as the row's pill: running, or waiting in a queue. */
export function taskState(jobs: Job[] | undefined, task: CloudTask, accountId: string | undefined): [string, Tone] | null {
  if (!jobs || !accountId) return null;
  const job = jobs.find((item) => item.accountId === accountId && item.targetId === task.targetId && item.taskId === task.taskId && ACTIVE.has(item.state));
  if (!job) return null;
  return job.state === "RUNNING" ? jobStatus(job) : ["排队中", "warn"];
}

/** Task rows: the name (★ when starred, the live state), its settings as grey pills, and ▶ to run it now. */
export function RunTaskRows({
  tasks, games, account, jobs, busy, notes, onRun, favorites,
}: {
  tasks: CloudTask[];
  games: Game[];
  account: GameAccount | undefined;
  jobs?: Job[];
  deviceId?: string;
  appKey?: string;
  busy: string | null;
  notes: Record<string, { text: string; ok: boolean }>;
  onRun: (task: CloudTask) => void;
  favorites?: Set<string>;
}) {
  return (
    <>
      {tasks.map((task) => {
        const detail = games.find((game) => game.id === task.targetId)?.tasks.find((item) => item.taskId === task.taskId);
        const chips = summarizeWebTaskConfig(detail, {}, 3);
        const state = taskState(jobs, task, account?.id);
        return (
          <div key={task.taskId} className={s.taskRow}>
            <Link to={paths.taskDetail(task.targetId, task.taskId, account?.id)} className={s.taskLink}>
              <span className={s.titleLine}>
                <b className={s.titleText}>{task.name}</b>
                {favorites?.has(favKey(task.targetId, task.taskId)) && <span className={s.starMark} aria-label="常用">★</span>}
                {state && <Pill tone={state[1]}>{state[0]}</Pill>}
              </span>
              {chips.length > 0 && <span className={s.chips}>{chips.map((chip) => <Pill key={chip}>{chip}</Pill>)}</span>}
              <Note note={notes[task.taskId]} />
            </Link>
            <Button small variant="primary" aria-label={`运行${task.name}`} title="运行" disabled={busy !== null} onClick={() => onRun(task)}>▶</Button>
          </div>
        );
      })}
    </>
  );
}

const searchIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>;

/** Level-1 `/tasks`: 全部 / ★ 常用, search, categories that fold, and ▶ to run a task now. */
export function LibraryPage() {
  const { data } = useConsole();
  const [chosen, setChosen] = useState(data.games[0]?.id ?? "");
  const game = data.games.find((item) => item.id === chosen) ?? data.games[0];
  const gameAccounts = game ? data.accounts.filter((account) => account.gameId === game.id) : [];
  const [chosenAccountId, setChosenAccountId] = useState(gameAccounts[0]?.id ?? "");
  const activeAccount = gameAccounts.find((a) => a.id === chosenAccountId) ?? gameAccounts[0];
  const [where, setWhere] = useState("");
  const [view, setView] = useState<"all" | "fav">("all");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [favorites] = useFavorites();
  const { notes, busy, run, clear } = useRunNow();
  const places = game ? data.devices.filter((d) => d.online).flatMap((d) => d.apps.filter((app) => app.gameId === game.id)
    .map((app) => ({ value: JSON.stringify([d.id, app.key]), label: d.apps.length > 1 ? `${d.name} · ${app.name}` : d.name, device: d, app }))) : [];
  const place = places.find((item) => item.value === where);

  if (!game) {
    return (
      <>
        <PageHeader title="任务" />
        <Card><Empty>连上设备后同步任务</Empty></Card>
      </>
    );
  }

  const starred = game.tasks.filter((t) => favorites.has(favKey(t.targetId, t.taskId)));
  const needle = query.trim().toLowerCase();
  const shown = (view === "fav" ? starred : game.tasks).filter((t) => !needle || t.name.toLowerCase().includes(needle));
  const groups = new Map<string, GameTask[]>();
  for (const t of shown) {
    const key = t.category || "全部任务";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const fold = (key: string) => { const next = new Set(folded); if (next.has(key)) next.delete(key); else next.add(key); setFolded(next); };

  return (
    <>
      <PageHeader title="任务" aside={gameAccounts.length === 0
        ? <ButtonLink to={paths.accounts}>＋ 添加账号</ButtonLink>
        : (
          <span className={s.pickers}>
            <span className={ui.tiny}>账号</span>
            <TextSelect label="账号" value={activeAccount?.id ?? ""} onChange={(next) => { setChosenAccountId(next); clear(); }}
              options={gameAccounts.map((a): [string, string] => [a.id, a.nickname ? `${a.name} · ${a.nickname}` : a.name])} />
            <span className={ui.tiny}>设备</span>
            <TextSelect label="设备" value={place ? where : ""} onChange={(next) => { setWhere(next); clear(); }}
              options={[["", "自动分配"], ...places.map((p): [string, string] => [p.value, p.label])]} />
          </span>
        )} />
      {data.games.length > 1 && <Segments label="游戏" value={game.id} onChange={(id) => { setChosen(id); clear(); }} items={data.games.map((item) => [item.id, item.name])} />}
      <div className={s.filterBar}>
        <SegmentTabs label="筛选" value={view} onChange={setView} items={[["all", `全部 ${game.tasks.length}`], ["fav", `★ 常用 ${starred.length}`]]} />
        <button type="button" className={s.iconButton} aria-label="搜索" aria-pressed={searching}
          onClick={() => { if (searching) setQuery(""); setSearching(!searching); }}>{searchIcon}</button>
      </div>
      {searching && <input type="search" className={s.search} autoFocus placeholder="搜任务" aria-label="搜任务" value={query} onChange={(e) => setQuery(e.target.value)} />}

      {groups.size === 0 && <Card><Empty>{needle ? "没有匹配的任务" : view === "fav" ? "还没有常用，在任务页点 ★" : "没有任务"}</Empty></Card>}
      {[...groups.entries()].map(([catLabel, catTasks]) => {
        const closed = folded.has(catLabel);
        return (
          <Card key={catLabel} flush as="section" aria-label={catLabel}>
            <button type="button" className={s.groupHead} aria-expanded={!closed} onClick={() => fold(catLabel)}>
              <b>{catLabel}</b><span className={ui.tiny}>{catTasks.length} 项</span>
              <svg className={closed ? s.chevron : `${s.chevron} ${s.chevronOpen}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {!closed && (
              <RunTaskRows
                tasks={catTasks.map(({ targetId, taskId, name }) => ({ targetId, taskId, name }))}
                games={data.games}
                account={activeAccount}
                jobs={data.jobs}
                busy={busy}
                notes={notes}
                favorites={favorites}
                onRun={(cTask) => {
                  if (!activeAccount) { navigate(paths.accounts); return; }
                  run(cTask, activeAccount.id, place ? { deviceId: place.device.id, appKey: place.app.key } : null,
                    place ? `已排进 ${place.label}` : "已提交");
                }}
              />
            )}
          </Card>
        );
      })}
    </>
  );
}

/** Level-2 `/tasks/:gameId/:taskId`: 参数（N）/ 步骤（N）, and 默认 / 保存 / ▶ 保存并开跑 fixed at the bottom. */
export function TaskDetailPage({ gameId, taskId }: { gameId: string; taskId: string }) {
  const { data } = useConsole();
  const game = data.games.find((g) => g.id === gameId);
  const detail = game?.tasks.find((t) => t.taskId === taskId);
  if (!game || !detail) return <NotFound text="没有这个任务" back={paths.tasks} backText="回到任务" />;
  return <TaskDetail gameId={gameId} taskId={taskId} detail={detail} />;
}

function TaskDetail({ gameId, taskId, detail }: { gameId: string; taskId: string; detail: GameTask }) {
  const { data } = useConsole();
  const queryAccount = useQuery().get("account") ?? "";
  const gameAccounts = data.accounts.filter((a) => a.gameId === gameId);
  const [accountId, setAccountId] = useState(() => (gameAccounts.some((a) => a.id === queryAccount) ? queryAccount : gameAccounts[0]?.id ?? ""));
  const activeAccount = gameAccounts.find((a) => a.id === accountId) ?? gameAccounts[0];
  const [tab, setTab] = useState<"config" | "steps">("config");
  const [values, setValues] = useState<Record<string, unknown>>(() => resolveTaskDefaults(detail));
  const [favorites, toggleFavorite] = useFavorites();
  const { busy, notes, run } = useRunNow();

  useEffect(() => {
    if (!activeAccount) {
      setValues(resolveTaskDefaults(detail));
      return;
    }
    let alive = true;
    api<ConfigView>(`/api/accounts/${enc(activeAccount.id)}/configs/${enc(gameId)}/${enc(taskId)}`)
      .then((cfg) => { if (alive) setValues(resolveTaskDefaults(detail, cfg.values)); })
      .catch(() => { if (alive) setValues(resolveTaskDefaults(detail)); });
    return () => { alive = false; };
  }, [activeAccount, detail, gameId, taskId]);

  const stepUrl = (stepId: string) => paths.taskStep(gameId, taskId, stepId, { accountId: activeAccount?.id });
  const steps = <TaskStepsList detail={detail} values={values} stepHref={stepUrl} />;
  const key = favKey(gameId, taskId);

  return (
    <>
      <Breadcrumb items={[["任务", paths.tasks], [detail.name, null]]} />
      <PageHeader
        title={detail.name}
        aside={
          <span className={s.pickers}>
            {gameAccounts.length > 1 && (
              <TextSelect label="账号" value={activeAccount?.id ?? ""} onChange={(next) => leave(() => setAccountId(next))}
                options={gameAccounts.map((a): [string, string] => [a.id, a.name])} />
            )}
            <StarButton on={favorites.has(key)} toggle={() => toggleFavorite(key)} />
          </span>
        }
      />
      <SegmentTabs label="任务内容" value={tab} onChange={setTab}
        items={[["config", `参数（${detail.fields.length}）`], ["steps", `步骤（${detail.stepDetails?.length ?? detail.steps.length}）`]]} />
      <Note note={notes[taskId]} />
      {activeAccount ? (
        <SettingsForm key={`${activeAccount.id}:${taskId}`} account={activeAccount} task={{ targetId: gameId, taskId, name: detail.name }} stepHref={stepUrl}
          replace={tab === "steps" ? steps : undefined} runBusy={busy !== null}
          onRun={() => run({ targetId: gameId, taskId }, activeAccount.id, null, "已提交")} />
      ) : tab === "steps" ? steps : (
        <Card><Row><span style={{ flex: 1 }}>先添加账号</span><ButtonLink to={paths.accounts}>＋ 添加账号</ButtonLink></Row></Card>
      )}
    </>
  );
}

/** Level-3 `/tasks/:gameId/:taskId/steps/:stepId`: whether the step runs, the settings it provides, and its actions. */
export function TaskStepDetailPage({ gameId, taskId, stepId }: { gameId: string; taskId: string; stepId: string }) {
  const { data } = useConsole();
  const detail = data.games.find((g) => g.id === gameId)?.tasks.find((t) => t.taskId === taskId);
  const step = detail?.stepDetails?.find((st) => st.id === stepId);
  if (!detail || !step) return <NotFound text="没有这个步骤" back={paths.tasks} backText="回到任务" />;
  return <TaskStepDetail gameId={gameId} taskId={taskId} detail={detail} step={step} />;
}

function TaskStepDetail({ gameId, taskId, detail, step }: { gameId: string; taskId: string; detail: GameTask; step: NonNullable<GameTask["stepDetails"]>[number] }) {
  const { data } = useConsole();
  const q = useQuery();
  const accountId = q.get("account") ?? undefined;
  const planId = q.get("plan") ?? undefined;
  const plan = planId ? data.plans.find((p) => p.id === planId) : undefined;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    resolveTaskDefaults(detail, plan?.taskConfigs?.[taskId] ?? {}),
  );

  useEffect(() => {
    if (plan) {
      setValues(resolveTaskDefaults(detail, plan.taskConfigs?.[taskId] ?? {}));
      return;
    }
    if (!accountId) return;
    let alive = true;
    api<ConfigView>(`/api/accounts/${enc(accountId)}/configs/${enc(gameId)}/${enc(taskId)}`)
      .then((cfg) => { if (alive) setValues(resolveTaskDefaults(detail, cfg.values)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [accountId, detail, gameId, plan, taskId]);

  const schemaById = new Map((detail.fieldsSchema ?? []).map((f) => [f.id, f]));
  const metaById = new Map(detail.fields.map((f) => [f.id, f]));
  const willRun = stepWillRun(step, values);
  const provided = step.providedFieldIds ?? [];
  const actions = step.actions ?? [];
  const current = (fid: string) => formatSettingValue(schemaById.get(fid), values[fid]) ?? metaById.get(fid)?.defaultLabel ?? "—";

  const crumbs: [string, string | null][] = plan && accountId
    ? [
        ["账号与计划", paths.accounts],
        [plan.name, paths.planEdit(accountId, plan.id)],
        [detail.name, paths.planTaskConfig(accountId, plan.id, taskId)],
        [`步骤 ${step.index}`, null],
      ]
    : [
        ["任务", paths.tasks],
        [detail.name, paths.taskDetail(gameId, taskId, accountId)],
        [`步骤 ${step.index}`, null],
      ];

  return (
    <>
      <Breadcrumb items={crumbs} />
      <PageHeader title={`步骤 ${step.index} · ${step.name}`} />
      <div className={s.stepState}>
        <Pill tone={willRun ? "ok" : ""}>{willRun ? "● 执行" : "○ 跳过"}</Pill>
        {step.conditionLabel && <span className={ui.tiny}>准入：{step.conditionLabel}</span>}
      </div>

      {provided.length > 0 && (
        <Card flush as="section">
          <CardHead title={`提供的设置（${provided.length}）`} />
          {provided.map((fid) => (
            <Row key={fid}>
              <span style={{ flex: 1 }}>{metaById.get(fid)?.label ?? fid}</span>
              <span className={ui.tiny}>默认：{metaById.get(fid)?.defaultLabel ?? "—"} · 当前：{current(fid)}</span>
            </Row>
          ))}
        </Card>
      )}

      <Card flush as="section">
        <CardHead title={`动作（${actions.length}）`} />
        {actions.length === 0 ? <Empty>没有动作</Empty> : actions.map((act, idx) => {
          const used = act.consumedFieldIds ?? [];
          const [kindText, tone] = actionKind(act.kind);
          return (
            <div key={`${act.id}-${idx}`} className={s.actionRow}>
              <Pill tone={tone} className={s.kind}>{kindText}</Pill>
              <span className={s.actionText}>
                {act.label}{act.detail && <span className={ui.tiny}> {act.detail}</span>}
                {used.length > 0 && (
                  <span className={s.consumes}>🎯 {used.map((fid) => `${metaById.get(fid)?.label ?? fid}（当前：${current(fid)}）`).join(" · ")}</span>
                )}
              </span>
            </div>
          );
        })}
      </Card>
    </>
  );
}
