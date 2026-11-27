// 画板 round trip over every task script: read → (no change) → write must give the same text, character for character;
// and the edits the board makes must change only the lines they touch.
// Run: node src/features/dev/canvas/roundtrip.test.mjs [tasks repo dir]   (from client/console)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";

const repo = process.argv[2] ?? "/Users/liuchunlang/hgb/hgb-tasks";
const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
const m = await server.ssrLoadModule(new URL("./script.ts", import.meta.url).pathname);

/** Every script: each step of a task file (the lines under `=== id: name ===`, without its [..] header lines) and each snippet file. */
function scripts() {
  const out = [];
  const games = join(repo, "games");
  for (const game of readdirSync(games)) {
    const tasks = join(games, game, "tasks"), snips = join(games, game, "snippets");
    if (existsSync(tasks)) for (const f of readdirSync(tasks).filter((x) => x.endsWith(".hgb"))) {
      const text = readFileSync(join(tasks, f), "utf8");
      const parts = text.split(/^=== .* ===$/m).slice(1);
      parts.forEach((p, i) => {
        const body = p.split("\n").slice(1);
        while (body.length && /^\[[^\]]+\]/.test(body[0])) body.shift();
        out.push({ name: `${game}/tasks/${f}#${i + 1}`, text: body.join("\n") });
      });
    }
    if (existsSync(snips)) for (const f of readdirSync(snips).filter((x) => x.endsWith(".hgb")))
      out.push({ name: `${game}/snippets/${f}`, text: readFileSync(join(snips, f), "utf8") });
  }
  return out;
}

const fails = [];
let lines = 0, stmts = 0, raw = 0, errors = 0, edits = 0;
const rawWords = new Map();
const fail = (name, what) => { if (fails.length < 40) fails.push(`${name}: ${what}`); else fails.length++; };
const all = scripts();
for (const { name, text } of all) {
  lines += text.split("\n").length;
  const doc = m.read(text);
  if (doc.error) { errors++; fail(name, `读不成树：第 ${doc.error.line} 行 ${doc.error.reason}`); continue; }
  // 1. Unchanged, written back the same.
  if (m.write(doc) !== text) fail(name, "写回和原文不一致");
  // 2. Every statement once, in order; every line with code is a statement.
  const order = m.walkOrder(doc);
  if (order.some((n, i) => i && n <= order[i - 1])) fail(name, "语句顺序乱了");
  const codeLines = text.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => m.splitLine(l).code.trim()).map(([n]) => n);
  if (codeLines.join() !== order.join()) fail(name, "有行没读成语句");
  for (const s of m.allStmts(doc)) {
    stmts++;
    if (s.kind === "raw") { raw++; rawWords.set(s.word, (rawWords.get(s.word) ?? 0) + 1); }
    const rawLine = doc.lines[s.line - 1];
    const { code } = m.splitLine(rawLine);
    // 3. Every field the drawer edits, set to what it is, leaves the line as it was.
    const same = (label, x) => { if (x !== code) fail(name, `L${s.line} ${label} 改回原值后变了：${code} → ${x}`); };
    for (const l of m.limits(code)) same(`最多…${l.unit}`, m.setLimit(code, l.unit, l.value));
    const r = m.regionOf(code); if (r) same("区域", m.setRegion(code, r.value));
    const im = m.imageOf(code); if (im) { same("图", m.setImage(code, im.name)); same("像到多少", m.setThreshold(code, im.threshold)); }
    const q = m.quotedOf(code); if (q) same("文字", m.setQuoted(code, q.value));
    if (["go", "use", "setting", "reset"].includes(s.kind)) { const a = m.argOf(code); if (a) same("参数", m.setArg(code, a.value)); }
    if (s.kind === "pause" || s.kind === "longWait") { const x = m.secondsOf(code); if (x) same("秒数", m.setSeconds(code, x.value)); }
    if (m.withCode(rawLine, code) !== rawLine) fail(name, `L${s.line} 缩进或注释没保住`);
    // 4. Edits touch only their lines: removing a statement takes exactly its lines; a copy adds exactly them.
    if (s.kind !== "else") {
      edits++;
      const before = text.split("\n");
      const removed = m.remove(text, s.line).split("\n");
      const expect = [...before.slice(0, m.leadOf(doc, s) - 1), ...before.slice(s.end)];
      if (removed.join("\n") !== expect.join("\n")) fail(name, `删 L${s.line} 动了别的行`);
      if (s.kind !== "case") {
        const dup = m.duplicate(text, s.line).text.split("\n");
        const want = [...before.slice(0, s.end), ...before.slice(s.line - 1, s.end), ...before.slice(s.end)];
        if (dup.join("\n") !== want.join("\n")) fail(name, `复制 L${s.line} 动了别的行`);
        // Put back where it was (after the line before it, or first in its block) gives the same text.
        const parent = s.parent;
        const siblings = parent ? (parent.else && parent.else.children.includes(s) ? parent.else.children : parent.children) : doc.roots;
        const i = siblings.indexOf(s);
        const place = i > 0 ? { kind: "after", line: siblings[i - 1].line }
          : { kind: "first", parent: parent ? (parent.kind === "else" ? parent.parent.line : parent.line) : null, branch: parent?.kind === "else" ? "else" : "children" };
        if (parent && parent.kind === "case") continue;
        const back = m.move(text, s.line, place);
        if (back.line && back.text !== text) fail(name, `把 L${s.line} 移回原处后变了`);
      }
      // 5. A new line after it: one line more, all others the same.
      if (s.kind !== "case") {
        const added = m.insert(text, { kind: "after", line: s.line }, ["等待 1秒"]);
        const a = added.text.split("\n");
        const back = [...a.slice(0, added.line - 1), ...a.slice(added.line)];
        if (back.join("\n") !== text || !/^\s*等待 1秒$/.test(a[added.line - 1])) fail(name, `在 L${s.line} 后插入动了别的行`);
        else if (m.read(added.text).error) fail(name, `在 L${s.line} 后插入后读不成树`);
      }
    }
  }
}
// Cases found in review: each edit's exact result.
const cases = [
  ["按设置：在最后一支后面加一个值（同级，不进这一支里面）", () => m.insert("按设置 mode\n  开\n    点 \"a\"@1,2,3,4\n  关\n    点 \"b\"@1,2,3,4\n等待 1秒", { kind: "after", line: 4 }, ["其他"]).text,
    "按设置 mode\n  开\n    点 \"a\"@1,2,3,4\n  关\n    点 \"b\"@1,2,3,4\n  其他\n等待 1秒"],
  ["分情况：一支的第一句之前插入", () => m.insert("分情况\n  甲 \"a\"@1,2,3,4\n    点 \"x\"@1,2,3,4\n  乙 \"b\"@1,2,3,4", { kind: "first", parent: 2, branch: "children" }, ["等待 1秒"]).text,
    "分情况\n  甲 \"a\"@1,2,3,4\n    等待 1秒\n    点 \"x\"@1,2,3,4\n  乙 \"b\"@1,2,3,4"],
  ["空的一支：插进这一支", () => m.insert("按设置 mode\n  开\n  关\n等待 1秒", { kind: "first", parent: 2, branch: "children" }, ["等待 2秒"]).text,
    "按设置 mode\n  开\n    等待 2秒\n  关\n等待 1秒"],
  ["搬动：上方第 0 列注释不把语句带出块外", () => m.move("如果看到 \"x\"@1,2,3,4\n# note\n  点 \"a\"@1,2,3,4\n  点 \"b\"@1,2,3,4\n反复 最多 3 次\n  等待 1秒", 3, { kind: "first", parent: 5, branch: "children" }).text,
    "如果看到 \"x\"@1,2,3,4\n  点 \"b\"@1,2,3,4\n反复 最多 3 次\n  # note\n  点 \"a\"@1,2,3,4\n  等待 1秒"],
  ["搬动：Tab 缩进的注释", () => m.move("反复 最多 3 次\n\t# tab\n  点 \"a\"@1,2,3,4\n  等待 1秒\n等待 2秒", 3, { kind: "after", line: 5 }).text,
    "反复 最多 3 次\n  等待 1秒\n等待 2秒\n# tab\n点 \"a\"@1,2,3,4"],
  ["只有注释的脚本插第一句：不多空行、末尾换行保留", () => m.insert("# hello\n", { kind: "top" }, ["等待 1秒"]).text, "# hello\n等待 1秒\n"],
  ["CRLF 的脚本插入后仍是 CRLF", () => m.insert("等待 1秒\r\n如果看到 \"x\"@1,2,3,4\r\n  点 \"a\"@1,2,3,4\r\n", { kind: "first", parent: 2, branch: "else" }, ["点 \"b\"@1,2,3,4"]).text,
    "等待 1秒\r\n如果看到 \"x\"@1,2,3,4\r\n  点 \"a\"@1,2,3,4\r\n否则\r\n  点 \"b\"@1,2,3,4\r\n"],
];
let caseFails = 0;
for (const [name, run, want] of cases) { const got = run(); if (got !== want) { caseFails++; console.log(`没通过：${name}\n  得到 ${JSON.stringify(got)}\n  应为 ${JSON.stringify(want)}`); } }
console.log(`编辑用例 ${cases.length} 个，没通过 ${caseFails} 个`);
if (caseFails) process.exitCode = 1;
await server.close();
console.log(`脚本 ${all.length} 段 · ${lines} 行 · 语句 ${stmts} 句（原样 ${raw} 句${raw ? `：${[...rawWords].map(([w, n]) => `${w || "(空)"}×${n}`).join("、")}` : ""}）· 读不成树 ${errors} 段 · 编辑检查 ${edits} 句`);
if (fails.length) { console.log(`没通过 ${fails.length} 处：`); for (const f of fails.slice(0, 40)) console.log("  " + f); process.exit(1); }
console.log("往返一致：读取 → 不改 → 写回，逐字相同；删、复制、移回、插入都只动涉及的行");
