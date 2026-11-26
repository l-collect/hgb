import { useState, type ReactNode } from "react";
import type { Account } from "../api/types";
import { ButtonLink, Card, Empty, Message, ui } from "../components/ui";
import { MergeCard } from "./me/AccountActions";
import { match, paths, usePath } from "../router";
import { Shell, type Section } from "../shell/Shell";
import { useConsoleStream } from "../state/console";
import { ConsoleContext } from "../state/context";
import { AccountDetailPage } from "./accounts/AccountDetailPage";
import { GameAccountsPage } from "./accounts/GameAccountsPage";
import { PlanDetailPage, PlanTaskConfigPage } from "./accounts/Plans";
import { AppPage } from "./devices/AppPage";
import { DevicePage } from "./devices/DevicePage";
import { DevicesPage } from "./devices/DevicesPage";
import { JobPage } from "./jobs/JobPage";
import { LibraryPage, TaskDetailPage, TaskStepDetailPage } from "./library/LibraryPage";
import { MeAccountPage, MePage } from "./me/MePage";
import { NoticesPage } from "./notices/NoticesPage";
import { DevWorkbench } from "./dev/DevWorkbench";
import { TasksDesk } from "./library/TasksDesk";
import { MeDesk } from "./me/MeDesk";
import { useWide } from "../shell/useWidth";

export function ConsolePage({ account, admin, signedOut }: { account: Account; admin: boolean; signedOut: () => void }) {
  const { data, connection, loaded } = useConsoleStream(signedOut);
  const path = usePath();
  const wide = useWide();
  const [section, page, full] = (wide && deskRoute(path)) || [...route(path), false] as const;
  const [linkFailed] = useState(() => {
    const failed = new URLSearchParams(location.search).get("error") === "github";
    if (failed) history.replaceState(null, "", location.pathname);
    return failed;
  });
  const [merge, setMerge] = useState(() => {
    const token = new URLSearchParams(location.search).get("merge");
    if (token) history.replaceState(null, "", location.pathname);
    return token;
  });
  return (
    <ConsoleContext.Provider value={{ data, account, signedOut }}>
      <Shell section={section} connection={connection} full={full} admin={admin}>
        {linkFailed && <Message text="GitHub 绑定失败，请重试" />}
        {merge && <MergeCard token={merge} settled={(merged) => { setMerge(null); if (merged) location.reload(); }} />}
        {loaded ? page : <Empty>正在加载…</Empty>}
      </Shell>
    </ConsoleContext.Provider>
  );
}

/**
 * On a wide window (≥1024) some addresses open the side-by-side layouts of the design instead of one page at a time:
 * a task opens beside the task list. The third value lets the page use the whole width.
 */
function deskRoute(path: string): readonly [Section, ReactNode, boolean] | null {
  let p: Record<string, string> | null;
  if (path === paths.tasks || path === "/library") return ["tasks", <TasksDesk />, true];
  if ((p = match("/tasks/:gameId/:taskId", path))) return ["tasks", <TasksDesk gameId={p.gameId} taskId={p.taskId} />, true];
  // A plan opens in a drawer over 账号与计划, and its task settings push into the same drawer.
  if (path === paths.accounts) return ["accounts", <GameAccountsPage />, true];
  const plan = (accountId: string, editor: ReactNode) => ["accounts", <GameAccountsPage accountId={accountId} drawer={editor} />, true] as const;
  if ((p = match("/accounts/:id/plans/new", path))) return plan(p.id, <PlanDetailPage key={`${p.id}:new`} accountId={p.id} drawer />);
  if ((p = match("/accounts/:id/presets/:presetId", path))) return plan(p.id, <PlanDetailPage key={`${p.id}:preset:${p.presetId}`} accountId={p.id} presetId={p.presetId} drawer />);
  if ((p = match("/accounts/:id/plans/:planId/tasks/:taskId", path))) {
    return plan(p.id, <PlanTaskConfigPage key={`${p.id}:${p.planId}:${p.taskId}`} accountId={p.id} planId={p.planId} taskId={p.taskId} drawer />);
  }
  if ((p = match("/accounts/:id/plans/:planId", path))) return plan(p.id, <PlanDetailPage key={`${p.id}:${p.planId}`} accountId={p.id} planId={p.planId} drawer />);
  // The runs table and its detail beside it.
  if (path === paths.devices) return ["devices", <DevicesPage />, true];
  // 我的 and 会员与账号 are groups of one settings page.
  if (path === paths.me || path === paths.meAccount) return ["me", <MeDesk />, false];
  return null;
}

function route(path: string): [Section, ReactNode] {
  let p: Record<string, string> | null;
  if (path === paths.tasks || path === "/library") return ["tasks", <LibraryPage />];
  if ((p = match("/tasks/:gameId/:taskId", path))) return ["tasks", <TaskDetailPage key={`${p.gameId}:${p.taskId}`} gameId={p.gameId} taskId={p.taskId} />];
  if ((p = match("/tasks/:gameId/:taskId/steps/:stepId", path))) return ["tasks", <TaskStepDetailPage key={`${p.gameId}:${p.taskId}:${p.stepId}`} gameId={p.gameId} taskId={p.taskId} stepId={p.stepId} />];
  if (path === paths.devices) return ["devices", <DevicesPage />];
  if ((p = match("/devices/:id", path))) return ["devices", <DevicePage key={p.id} id={p.id} />];
  if ((p = match("/devices/:id/apps/:key", path))) return ["devices", <AppPage key={p.id + p.key} deviceId={p.id} appKey={p.key} />];
  if (path === paths.accounts) return ["accounts", <GameAccountsPage />];
  if ((p = match("/accounts/:id", path))) return ["accounts", <AccountDetailPage key={p.id} id={p.id} tab="settings" />];
  if ((p = match("/accounts/:id/plans/new", path))) return ["accounts", <PlanDetailPage key={`${p.id}:new`} accountId={p.id} />];
  if ((p = match("/accounts/:id/plans/:planId", path))) return ["accounts", <PlanDetailPage key={`${p.id}:${p.planId}`} accountId={p.id} planId={p.planId} />];
  if ((p = match("/accounts/:id/presets/:presetId", path))) return ["accounts", <PlanDetailPage key={`${p.id}:preset:${p.presetId}`} accountId={p.id} presetId={p.presetId} />];
  if ((p = match("/accounts/:id/plans/:planId/tasks/:taskId", path))) {
    return ["accounts", <PlanTaskConfigPage key={`${p.id}:${p.planId}:${p.taskId}`} accountId={p.id} planId={p.planId} taskId={p.taskId} />];
  }
  if ((p = match("/accounts/:id/plans", path))) return ["accounts", <AccountDetailPage key={p.id} id={p.id} tab="plans" />];
  if ((p = match("/accounts/:id/runs", path))) return ["accounts", <AccountDetailPage key={p.id} id={p.id} tab="runs" />];
  if ((p = match("/jobs/:id", path))) return ["devices", <JobPage key={p.id} id={p.id} />];
  if (path === paths.notices) return ["devices", <NoticesPage />];
  if (path === paths.me) return ["me", <MePage />];
  if (path === paths.meAccount) return ["me", <MeAccountPage />];
  if (path === paths.dev || path.startsWith(`${paths.dev}/`)) return ["dev", <DevWorkbench />];
  return ["tasks", <NotFound text="没有这个页面" back={paths.tasks} backText="回到任务" />];
}

export function NotFound({ text, back = paths.devices, backText = "返回" }: { text: string; back?: string; backText?: string }) {
  return <Card><Empty>{text}</Empty><div className={ui.center}><ButtonLink to={back}>{backText}</ButtonLink></div></Card>;
}
