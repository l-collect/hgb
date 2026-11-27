/** What 添加 offers, grouped as the cards are coloured (Add.dc.html): the lines each one writes into the script. */
import type { Group, Kind } from "./script";

export interface MakeCtx {
  /** A region covering the whole screen, in the game's reference numbers (`0,0,2400,1080`). */
  full: string;
  page: string | null; template: string | null; snippet: string | null;
  /** Whether the place is inside a 反复 (跳出 only makes sense there). */
  inLoop: boolean;
}
export interface Item {
  id: string; kind: Kind; group: Group; icon: string; label: string; hint: string; menu: string;
  /** The lines to write (relative indentation), or "field" when a setting has to be chosen first (按配置项分). */
  make: (c: MakeCtx) => string[] | "field";
  when?: (c: MakeCtx) => boolean;
}
export const MENUS: [string, string][] = [["run", "走到哪"], ["act", "操作"], ["if", "判断"], ["loop", "反复"], ["end", "复用与收尾"]];

export const ITEMS: Item[] = [
  { id: "go", kind: "go", group: "run", menu: "run", icon: "→", label: "去", hint: "去某个页面", make: (c) => [`去 ${c.page ?? "页面名"}`] },
  { id: "wait", kind: "wait", group: "run", menu: "run", icon: "⏱", label: "等", hint: "等到出现", make: (c) => [`等 "文字"@${c.full} 最多 10秒`] },
  { id: "pause", kind: "pause", group: "run", menu: "run", icon: "⌛", label: "等一会", hint: "固定秒数", make: () => ["等待 2秒"] },
  { id: "launch", kind: "launch", group: "run", menu: "run", icon: "▶", label: "启动游戏", hint: "启动并等到前台", make: () => ["启动游戏"] },
  { id: "longWait", kind: "longWait", group: "run", menu: "run", icon: "⌛", label: "长等待", hint: "放宽看门狗", make: () => ["长等待 300秒"] },
  { id: "tapText", kind: "tap", group: "act", menu: "act", icon: "☝", label: "点", hint: "点文字", make: (c) => [`点 "文字"@${c.full}`] },
  { id: "tapImage", kind: "tap", group: "act", menu: "act", icon: "☝", label: "点图", hint: "点图标", make: (c) => [`点 图 ${c.template ?? "图名"}@${c.full}`] },
  { id: "tapBlank", kind: "tap", group: "act", menu: "act", icon: "☝", label: "点空白", hint: "点目标旁的空白处", make: (c) => [`点空白 "文字"@${c.full} 偏 0,200`] },
  { id: "drag", kind: "drag", group: "act", menu: "act", icon: "↔", label: "拖", hint: "从锚点旁拖", make: (c) => [`拖 "文字"@${c.full} 偏 0,0 到 0,-200`] },
  { id: "reset", kind: "reset", group: "act", menu: "act", icon: "↺", label: "清零", hint: "清零点击次数", make: () => ["清零 计数名"] },
  { id: "ifSee", kind: "ifSee", group: "if", menu: "if", icon: "◇", label: "如果看到", hint: "带两条支路", make: (c) => [`如果看到 "文字"@${c.full} 最多 3秒`] },
  { id: "ifNot", kind: "ifNot", group: "if", menu: "if", icon: "◇", label: "如果没看到", hint: "没看到时做", make: (c) => [`如果没看到 "文字"@${c.full} 最多 3秒`] },
  { id: "ifHas", kind: "ifHas", group: "if", menu: "if", icon: "◇", label: "如果有", hint: "刚等到的画面上有没有", make: (c) => [`如果有 "文字"@${c.full}`] },
  { id: "cases", kind: "cases", group: "if", menu: "if", icon: "⑂", label: "分情况", hint: "等到其一，走那支", make: (c) => ["分情况 最多 8秒", `  情况一 "文字"@${c.full}`, `  情况二 "文字"@${c.full}`] },
  { id: "setting", kind: "setting", group: "if", menu: "if", icon: "⑂", label: "按配置项分", hint: "每个选项一条支路", make: () => "field" },
  { id: "repeat", kind: "repeat", group: "loop", menu: "loop", icon: "⟳", label: "反复", hint: "圈住后面几步", make: () => ["反复 最多 3 次", "  等待 1秒"] },
  { id: "until", kind: "until", group: "loop", menu: "loop", icon: "⟳", label: "直到", hint: "反复做，到了就停", make: (c) => [`直到 "文字"@${c.full} 最多 3 次`, "  等待 1秒"] },
  { id: "each", kind: "each", group: "loop", menu: "loop", icon: "⟳", label: "逐个", hint: "每个值做一遍", make: () => ["逐个 名 在 甲,乙", "  等待 1秒"] },
  { id: "exit", kind: "exit", group: "end", menu: "loop", icon: "⤴", label: "跳出", hint: "结束所在的反复", make: () => ["跳出"], when: (c) => c.inLoop },
  { id: "use", kind: "use", group: "end", menu: "end", icon: "⧉", label: "片段", hint: "调用片段", make: (c) => [`用 ${c.snippet ?? "片段名"}`] },
  { id: "result", kind: "result", group: "end", menu: "end", icon: "⚑", label: "结果", hint: "写一句结果", make: () => ["结果 \"完成\""] },
  { id: "stop", kind: "stop", group: "end", menu: "end", icon: "■", label: "停下", hint: "写明原因停下", make: () => ["停下 \"原因\""] },
  { id: "report", kind: "report", group: "end", menu: "end", icon: "⇪", label: "上报", hint: "排后续任务", make: () => ["上报 事件名"] },
];

/** What usually comes after [kind]: the short menu when a line is dragged out to empty space. */
export function suggest(kind: Kind | null): string[] {
  switch (kind) {
    case "tap": return ["wait", "pause", "ifSee", "tapText"];
    case "go": return ["tapText", "wait", "ifSee", "tapImage"];
    case "wait": return ["tapText", "tapImage", "ifHas", "ifSee"];
    case "ifSee": case "ifNot": case "ifHas": return ["tapText", "wait", "result", "exit"];
    default: return ["tapText", "wait", "pause", "ifSee"];
  }
}

/** The three common starts of an empty step (Add.dc.html D). */
export const STARTERS: { label: string; make: (c: MakeCtx) => string[] }[] = [
  { label: "去页面 → 点 → 结果", make: (c) => [`去 ${c.page ?? "页面名"}`, `点 "文字"@${c.full}`, "结果 \"完成\""] },
  { label: "如果看到 → 点", make: (c) => [`如果看到 "文字"@${c.full} 最多 3秒`, `  点 "文字"@${c.full}`] },
  { label: "反复 N 次", make: (c) => ["反复 最多 3 次", `  点 "文字"@${c.full}`, "  等待 1秒"] },
];
