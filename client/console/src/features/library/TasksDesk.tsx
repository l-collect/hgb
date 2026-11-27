import { useState, type ReactNode, useEffect } from "react";
import { api, enc } from "../../api/client";
import type { Device, App, Game, GameAccount, GameTask, Plan } from "../../api/types";
import { Button, ButtonLink, Card, CardHead, Empty, LiveSwitch, PageHeader, Pill, Row, Segments, SegmentTabs, TextSelect, join, ui } from "../../components/ui";
import { clockText, jobStatus, shortTime } from "../../format";
import { leave, Link, navigate, paths, useQuery } from "../../router";
import { useConsole } from "../../state/context";
import { useDesk } from "../../shell/useWidth";
import { saveOf } from "../accounts/Plans";
import { SettingsForm, summarizeWebTaskConfig, TaskStepsList, resolveTaskDefaults } from "../accounts/Settings";
import { Note, useRunNow, useSwitchLocked } from "../jobs/runs";
import { ProLimitButton, ProLockButton, ProLockRow } from "../../components/Pro";
import { favKey, RunNeeds, StarButton, taskState, useFavorites } from "./LibraryPage";
import { InstallAppCard } from "../onboarding/Onboarding";
import d from "../../shell/Desk.module.css";
import s from "./Library.module.css";

type Place = { value: string; label: string; device: Device; app: App };

/**
 * 任务与日常 on a wide window (网页桌面 · 任务): the tasks on the left, the chosen one's settings in the middle, and from
 * 1280 where it runs, its runs and the plans that use it on the right (below the settings when narrower). Choosing a
 * task changes the address, so each task can still be opened directly.
 */
export function TasksDesk({ gameId, taskId }: { gameId?: string; taskId?: string }) {
  const { data } = useConsole();
  const desk = useDesk();
  const queryAccount = useQuery().get("account") ?? "";
  const [chosenGame, setChosenGame] = useState(gameId ?? data.games[0]?.id ?? "");
  const game = data.games.find((item) => item.id === (gameId ?? chosenGame)) ?? data.games[0];
  const accounts = game ? data.accounts.filter((account) => account.gameId === game.id) : [];
  const [accountId, setAccountId] = useState(queryAccount);
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const [where, setWhere] = useState("");
  const places: Place[] = game ? data.devices.filter((dev) => dev.online).flatMap((dev) => dev.apps.filter((app) => app.gameId === game.id)
    .map((app) => ({ value: JSON.stringify([dev.id, app.key]), label: dev.apps.length > 1 ? `${dev.name} · ${app.name}` : dev.name, device: dev, app }))) : [];
  const place = places.find((item) => item.value === where);
  const run = useRunNow();
  const switchLocked = useSwitchLocked(game?.id, account?.id, place?.app);

  if (!game) {
    return (
      <>
        <PageHeader title="任务与日常" />
        {data.devices.length === 0 ? <InstallAppCard /> : <Card><Empty>连上设备后同步任务</Empty></Card>}
      </>
    );
  }
  const task = taskId ? game.tasks.find((item) => item.taskId === taskId) : game.tasks[0];
  // Another account shows its own settings: unsaved edits are asked about first.
  const pickAccount = (next: string) => leave(() => {
    setAccountId(next); run.clear();
    if (task) navigate(paths.taskDetail(game.id, task.taskId, next), { replace: true, force: true });
  });
  const runTask = (target: GameTask) => {
    if (!account) { navigate(paths.accounts); return; }
    return run.run(target, account.id, place ? { deviceId: place.device.id, appKey: place.app.key } : null);
  };
  const accountOptions = accounts.map((a): [string, string] => [a.id, a.nickname ? `${a.name} · ${a.nickname}` : a.name]);
  const placeOptions: [string, string][] = [["", "自动分配"], ...places.map((p): [string, string] => [p.value, p.label])];
  const pickers = accounts.length > 0 ? {
    account: <TextSelect label="账号" value={account?.id ?? ""} onChange={pickAccount} options={accountOptions} />,
    place: <TextSelect label="设备" value={place ? where : ""} onChange={(next) => { setWhere(next); run.clear(); }} options={placeOptions} />,
  } : null;
  // Two columns (1024–1279): 在哪跑 sits in the title row, where it is seen before ▶; with three it heads the right column.
  const lockRow = switchLocked ? <ProLockRow compact name="自动切号" label={`切到${account?.name ?? "这个账号"}跑`} /> : null;
  const context = task && <TaskContext game={game} task={task} account={account} plans={data.plans} pickers={desk ? pickers : null} lock={lockRow} />;

  return (
    <>
      <PageHeader title="任务与日常" aside={!desk && pickers ? (
        <span className={s.pickers} aria-label="在哪跑"><span className={ui.tiny}>账号</span>{pickers.account}<span className={ui.tiny}>设备</span>{pickers.place}</span>
      ) : undefined} />
      {data.games.length > 1 && <Segments label="游戏" value={game.id} onChange={(id) => leave(() => { setChosenGame(id); run.clear(); navigate(paths.tasks, { force: true }); })} items={data.games.map((item) => [item.id, item.name])} />}
      {data.devices.length === 0 && <InstallAppCard />}
      <div className={join(d.cols, d.cols3)}>
        <TaskList game={game} current={task?.taskId} account={account} notes={run.notes} busy={run.busy} onRun={runTask} locked={switchLocked}
          blocked={!account || data.devices.length === 0} />
        <div className={d.detail}>
          {!task ? <Card><Empty>{taskId ? "没有这个任务" : "没有任务"}</Empty></Card> : (
            <TaskPane key={`${game.id}:${task.taskId}:${account?.id ?? ""}`} game={game} task={task} account={account}
              note={<Note note={run.notes[task.taskId]} />} runBusy={run.busy !== null} onRun={() => runTask(task)} locked={switchLocked} />
          )}
          {!desk && context}
        </div>
        {desk && <aside className={d.side} aria-label="任务上下文">{context}</aside>}
      </div>
    </>
  );
}

/** The left column: 全部 / ★ 常用, a search box, and the tasks by category; ▶ runs one now (shown on hover with a mouse). */
function TaskList({ game, current, account, notes, busy, onRun, locked, blocked }: {
  game: Game; current?: string; account?: GameAccount; notes: Record<string, { text: string; ok: boolean }>; busy: string | null; onRun: (task: GameTask) => void; locked?: boolean;
  /** No account or no device yet: ▶ is grey. */
  blocked?: boolean;
}) {
  const { data } = useConsole();
  const [view, setView] = useState<"all" | "fav">("all");
  const [query, setQuery] = useState("");
  const [favorites] = useFavorites();
  // Accordion: the group holding the open task starts open (and opens when another task is picked), the rest start
  // folded; any group can be opened or folded, and every group shows while searching.
  const groupOf = (taskId?: string) => { const t = game.tasks.find((x) => x.taskId === taskId); return t ? (t.category || "全部任务") : undefined; };
  const [opened, setOpened] = useState<Set<string>>(() => new Set([groupOf(current) ?? ""]));
  useEffect(() => { const g = groupOf(current); if (g) setOpened((prev) => (prev.has(g) ? prev : new Set(prev).add(g))); }, [current, game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (label: string) => setOpened((prev) => { const next = new Set(prev); if (next.has(label)) next.delete(label); else next.add(label); return next; });
  const starred = game.tasks.filter((t) => favorites.has(favKey(t.targetId, t.taskId)));
  const needle = query.trim().toLowerCase();
  const shown = (view === "fav" ? starred : game.tasks).filter((t) => !needle || t.name.toLowerCase().includes(needle));
  const groups = new Map<string, GameTask[]>();
  for (const t of shown) {
    const key = t.category || "全部任务";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return (
    <nav className={d.side} aria-label="任务">
      <SegmentTabs label="筛选" value={view} onChange={setView} items={[["all", `全部 ${game.tasks.length}`], ["fav", `★ 常用 ${starred.length}`]]} />
      <input type="search" className={d.search} placeholder="搜索任务" aria-label="搜索任务" value={query} onChange={(e) => setQuery(e.target.value)} />
      {!account && <RunNeeds />}
      {groups.size === 0 && <Card><Empty>{needle ? "没有匹配的任务" : view === "fav" ? "还没有常用，点 ★" : "没有任务"}</Empty></Card>}
      {[...groups.entries()].map(([label, tasks]) => (
        <Card key={label} flush as="section" aria-label={label}>
          {(() => {
            const open = !!needle || opened.has(label);
            return <>
          <button type="button" className={d.groupHead} aria-expanded={open} onClick={() => toggle(label)}>
            {label} · {tasks.length}<span className={d.chev} aria-hidden="true">▾</span>
          </button>
          {open && tasks.map((task) => {
            const chips = summarizeWebTaskConfig(task, {}, 3);
            const state = taskState(data.jobs, task, account?.id, data.devices);
            return (
              <div key={task.taskId} className={d.pick} aria-current={task.taskId === current ? "true" : undefined}>
                <Link to={paths.taskDetail(task.targetId, task.taskId, account?.id)} className={d.pickLink} aria-current={task.taskId === current ? "page" : undefined}>
                  <span className={s.titleLine}>
                    <b className={s.titleText}>{task.name}</b>
                    {favorites.has(favKey(task.targetId, task.taskId)) && <span className={s.starMark} aria-label="常用">★</span>}
                    {state && <Pill tone={state[1]}>{state[0]}</Pill>}
                  </span>
                  {chips.length > 0 && <span className={s.chips}>{chips.map((chip) => <Pill key={chip}>{chip}</Pill>)}</span>}
                  {task.taskId !== current && <Note note={notes[task.taskId]} />}
                </Link>
                <span className={d.hoverOnly}>
                  {locked ? <ProLockButton name={`切号运行${task.name}`} />
                    : <Button small variant="primary" aria-label={`运行${task.name}`} title={blocked ? "先添加账号和设备" : "运行"} disabled={busy !== null || blocked} onClick={() => onRun(task)}>▶</Button>}
                </span>
              </div>
            );
          })}
            </>;
          })()}
        </Card>
      ))}
    </nav>
  );
}

/** The middle column: the task's name and ★, the bar fixed at the top, the steps to jump to, and every settings card. */
function TaskPane({ game, task, account, note, runBusy, onRun, locked }: {
  game: Game; task: GameTask; account?: GameAccount; note: ReactNode; runBusy: boolean; onRun: () => void; locked?: boolean;
}) {
  const [favorites, toggleFavorite] = useFavorites();
  const key = favKey(game.id, task.taskId);
  const stepHref = (stepId: string) => paths.taskStep(game.id, task.taskId, stepId, { accountId: account?.id });
  const head = (
    <span className={s.titleLine}>
      <h2 style={{ fontSize: "var(--text-2xl)", fontWeight: 700 }}>{task.name}</h2>
      <StarButton on={favorites.has(key)} toggle={() => toggleFavorite(key)} />
      {note}
    </span>
  );
  if (!account) {
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 56 }}>{head}</div>
        <Card><Row><span style={{ flex: 1 }}>先添加账号</span><ButtonLink to={paths.accounts}>＋ 添加账号</ButtonLink></Row></Card>
        <TaskStepsList detail={task} values={resolveTaskDefaults(task)} stepHref={stepHref} />
      </>
    );
  }
  return (
    <SettingsForm desk head={head} account={account} task={{ targetId: game.id, taskId: task.taskId, name: task.name }}
      stepHref={stepHref} runBusy={runBusy} onRun={onRun}
      runLocked={locked ? <ProLimitButton small text="保存并开跑" what="自动切号" label="切号运行需 Pro，去开通" /> : undefined} />
  );
}

/** The right column: 在哪跑, this task's latest runs for the account, and the plans that include it. */
function TaskContext({ game, task, account, plans, pickers, lock }: {
  game: Game; task: GameTask; account?: GameAccount; plans: Plan[]; pickers: { account: ReactNode; place: ReactNode } | null;
  /** The 单行锁 when running here needs an account switch the free tier does not allow. */
  lock?: ReactNode;
}) {
  const { data } = useConsole();
  const runs = data.jobs.filter((job) => job.targetId === game.id && job.taskId === task.taskId && (!account || job.accountId === account.id)).slice(0, 4);
  const using = account ? plans.filter((plan) => plan.accountId === account.id && plan.tasks.some((t) => t.taskId === task.taskId)) : [];
  return (
    <>
      {pickers && (
        <Card flush as="section" aria-label="在哪跑">
          <CardHead soft title="在哪跑" />
          <Row><span style={{ flex: 1 }}>账号</span>{pickers.account}</Row>
          <Row><span style={{ flex: 1 }}>设备</span>{pickers.place}</Row>
          {lock}
        </Card>
      )}
      {!pickers && lock && <Card flush>{lock}</Card>}
      <Card flush as="section" aria-label="这个任务的战报">
        <CardHead soft title="这个任务的战报" aside={account ? <Link to={paths.account(account.id, "runs")} className={ui.tiny} style={{ textDecoration: "none" }}>全部 ›</Link> : undefined} />
        {runs.length === 0 ? <Empty>还没有战报</Empty> : runs.map((job) => {
          const [label, tone] = jobStatus(job, data.devices);
          return (
            <Link key={job.id} to={paths.job(job.id)} className={join(ui.row, ui.rowLink)} style={{ minHeight: 44 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-sm)" }}>{shortTime(job.updatedAt)}{job.deviceName ? ` · ${job.deviceName}` : ""}</span>
              <Pill tone={tone}>{label}</Pill>
            </Link>
          );
        })}
      </Card>
      {account && (
        <Card flush as="section" aria-label="用在计划">
          <CardHead soft title="用在计划" />
          {using.length === 0 ? <Empty>没有计划用到</Empty> : using.map((plan) => (
            <Row key={plan.id}>
              <Link to={paths.planEdit(account.id, plan.id)} style={{ flex: 1, minWidth: 0, color: "inherit", textDecoration: "none", fontSize: "var(--text-sm)" }}>
                {plan.name} · <span className={ui.mono}>{clockText(plan.minuteOfDay)}</span>
              </Link>
              <LiveSwitch label={`启用${plan.name}`} checked={plan.enabled}
                save={(on) => api(`/api/plans/${enc(plan.id)}`, { method: "PUT", body: saveOf(plan, { enabled: on }) })} />
            </Row>
          ))}
        </Card>
      )}
    </>
  );
}
