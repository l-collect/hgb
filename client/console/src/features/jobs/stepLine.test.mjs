// node --experimental-strip-types stepLine.test.mjs  (or: node stepLine.test.mjs on Node ≥ 23)
import assert from "node:assert/strict";
const { lineOf, lineOfAction } = await import("./stepLine.ts");
const cases = [["L12w", 12], ["L3_2p", 3], ["L12#0.L13w", 13], ["L12#0.L13#2.L20w", 20], ["L83.L4w", 83], ["L3w~lost.L1p", 3],
  ["L5#1.L7.L2w", 7], ["L9#0~x.L1w", 9], ["tap", null], ["", null]];
for (const [action, want] of cases) assert.equal(lineOfAction(action), want, action);
const ev = (action, detail = "") => ({ at: 0, kind: "action", step: "s", stepName: "", action, detail, elapsedMs: 0 });
assert.equal(lineOf([ev("L2w"), ev("L12#0.L13w")]), 13);
assert.equal(lineOf([ev("L2w"), { ...ev(""), kind: "task-failed", detail: "第 9 行 卡住" }]), 2);
assert.equal(lineOf([{ ...ev(""), kind: "task-failed", detail: "第 9 行 卡住" }]), null);
console.log(`stepLine: ${cases.length + 3} ok`);
