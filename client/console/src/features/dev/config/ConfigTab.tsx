import { ConfigPanel } from "./ConfigPanel";

/**
 * The script view's 配置项 tab, beside 写法 / 画面 / 问题: the task's settings, their test values and how many lines read
 * each (none: yellow), ＋ 新建 on top; a row opens its whole form.
 */
export function ConfigTab({ taskId }: { taskId: string }) {
  return <ConfigPanel taskId={taskId} embedded />;
}
