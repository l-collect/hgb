import { useState } from "react";
import { api, enc } from "../../api/client";
import type { EventFollowUp } from "../../api/types";
import { Button, Card, Field, Form, Grow, LiveSwitch, Muted, Row } from "../../components/ui";
import { orToast } from "../../components/useAction";
import { ask } from "../../components/Confirm";
import { useConsole } from "../../state/context";
import { useNotices } from "./NoticesPage";
import s from "./Notices.module.css";

/**
 * 事件续排: a script's event (`上报 事件名`) queues a follow-up task for the same game account. Not a notice, so it is not
 * on the 通知 page; it is mounted where the account's tasks are set up.
 */
export function FollowUps() {
  const { data } = useConsole();
  const [items] = useNotices<EventFollowUp[]>("/api/notifications/follow-ups");
  const [adding, setAdding] = useState(false);
  const games = data.games.filter((g) => g.tasks.length > 0);
  const [targetId, setTargetId] = useState(games[0]?.id ?? "");
  const game = games.find((g) => g.id === targetId) ?? games[0];
  const [eventName, setEventName] = useState("");
  const [taskId, setTaskId] = useState(game?.tasks[0]?.taskId ?? "");
  if (!items && !games.length) return null;
  const chosenTask = game?.tasks.some((t) => t.taskId === taskId) ? taskId : game?.tasks[0]?.taskId ?? "";
  return (
    <Card flush as="section" aria-label="事件续排任务">
      <Row>
        <Grow><h2 className={s.groupTitle} style={{ padding: 0 }}>事件续排<Muted as="span"> · 上报后排入后续任务</Muted></h2></Grow>
        {games.length > 0 && <Button small onClick={() => setAdding(!adding)}>{adding ? "收起" : "新建"}</Button>}
      </Row>
      {adding && game && (
        <div style={{ padding: "12px 16px" }}><Form onSubmit={(e) => {
          e.preventDefault();
          if (!eventName.trim() || !chosenTask) return;
          void orToast(async () => {
            await api("/api/notifications/follow-ups", { method: "POST", body: { targetId: game.id, eventName: eventName.trim(), taskId: chosenTask, enabled: true } });
            setEventName(""); setAdding(false);
          }, "已保存");
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            {games.length > 1 && <Field label="游戏"><select value={game.id} onChange={(e) => setTargetId(e.target.value)}>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>}
            <Field label="脚本上报的事件名"><input required maxLength={60} value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="如 悬赏邀请" /></Field>
            <Field label="排入后续任务"><select value={chosenTask} onChange={(e) => setTaskId(e.target.value)}>
              {game.tasks.map((t) => <option key={t.taskId} value={t.taskId}>{t.name}</option>)}</select></Field>
            <Button variant="primary" type="submit">保存</Button>
          </div>
        </Form></div>
      )}
      {(items ?? []).map((item) => (
        <Row key={item.id} className={s.rule}>
          <Grow className={s.ruleText}><b>上报「{item.eventName}」→ 排入「{item.taskName}」</b>
            <Muted as="span">{data.games.find((g) => g.id === item.targetId)?.name ?? item.targetId}</Muted></Grow>
          <LiveSwitch checked={item.enabled} label={`启用续排：${item.eventName}`} save={(on) => api("/api/notifications/follow-ups",
            { method: "POST", body: { targetId: item.targetId, eventName: item.eventName, taskId: item.taskId, enabled: on } })} />
          <Button small variant="danger" onClick={async () => {
            if (!await ask({ title: `删除续排「${item.eventName}」？`, body: `上报后不再排入「${item.taskName}」`, ok: "删除", danger: true })) return;
            await orToast(() => api(`/api/notifications/follow-ups/${enc(item.id)}`, { method: "DELETE" }), "已删除");
          }}>删除</Button>
        </Row>
      ))}
      {(items ?? []).length === 0 && !adding && <div style={{ padding: "8px 16px 14px" }}><Muted>还没有续排</Muted></div>}
    </Card>
  );
}

