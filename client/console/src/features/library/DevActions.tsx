import { join, Popover, ui } from "../../components/ui";
import { Link } from "../../router";
import { useDeveloper, withGame, workbenchPaths } from "../../state/developer";
import s from "./Library.module.css";

/** 开发 ▾ beside a task's name, for developers: its settings (改配置项) or its script (编辑脚本) in the workbench. */
export function DevTaskMenu({ gameId, taskId }: { gameId: string; taskId: string }) {
  const developer = useDeveloper();
  if (!developer) return null;
  return (
    <Popover label="开发" plain align="end" trigger={<span className={s.devTrigger}>开发 ▾</span>}>
      {(close) => <>
        <Link role="menuitem" className={ui.menuItem} to={withGame(workbenchPaths.config(taskId), gameId)} onClick={close}>改配置项</Link>
        <Link role="menuitem" className={ui.menuItem} to={withGame(workbenchPaths.task(taskId), gameId)} onClick={close}>编辑脚本</Link>
      </>}
    </Popover>
  );
}

/** 编辑这一步 on a step's page, for developers. */
export function DevStepButton({ gameId, taskId, stepId }: { gameId: string; taskId: string; stepId: string }) {
  const developer = useDeveloper();
  if (!developer) return null;
  return <Link className={join(ui.button, ui.small, ui.ghost)} to={withGame(workbenchPaths.step(taskId, stepId), gameId)}>编辑这一步</Link>;
}
