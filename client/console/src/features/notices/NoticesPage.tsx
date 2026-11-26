import { useEffect, useRef, useState } from "react";
import { api, enc } from "../../api/client";
import type { Channel, EventFollowUp, EventRule, Notice, PlanOutcome } from "../../api/types";
import { Breadcrumb, Button, Card, Empty, ErrorCard, Field, Form, Grow, LiveSwitch, Loading, Muted, PageHeader, PageTabs, Pill, Row, TextSelect } from "../../components/ui";
import { orToast } from "../../components/useAction";
import { ask } from "../../components/Confirm";
import { shortTime, type Tone } from "../../format";
import { Link, paths, useQuery } from "../../router";
import { useConsole } from "../../state/context";
import { Channels as ChannelList, DeliveryPill } from "./Channels";
import s from "./Notices.module.css";

/** Rules grouped as the design shows them; a rule the server adds later falls into 其他 until it is placed here. */
const GROUPS: [string, string, string[]][] = [
  ["任务", "", ["task-started", "task-succeeded", "execution-failed", "unknown-result", "queue-wait"]],
  ["计划", "", ["plan-started", "plan-completed", "plan-missed"]],
  ["设备与账号", "", ["device-offline", "account-not-restored"]],
  ["设备上报", "", ["no-progress", "condition-lost"]],
];
const TONES: Record<string, Tone> = { "execution-failed": "bad", "unknown-result": "warn", "account-not-restored": "warn", "plan-missed": "warn",
  "device-offline": "", "queue-wait": "warn", "no-progress": "warn", "condition-lost": "bad", "plan-completed": "info", "plan-started": "info", "task-started": "info", "task-succeeded": "ok" };
const PAGE = 50;
const OUTCOMES: [PlanOutcome, string][] = [["COMPLETED", "全部完成"], ["PARTIAL_FAILED", "部分失败"], ["FAILED", "失败"], ["CANCELLED", "已取消"]];

/** 通知: what the rules noticed, the rules themselves, and (next) the channels that deliver them. */
export function NoticesPage() {
  const tab = useQuery().get("tab") ?? "log";
  return (
    <>
      <Breadcrumb items={[["设备与战报", paths.devices], ["通知", null]]} />
      <PageHeader title="通知" />
      <PageTabs label="通知内容" value={tab} tabs={[["log", "事件记录", paths.notices], ["rules", "规则", `${paths.notices}?tab=rules`], ["channels", "渠道", `${paths.notices}?tab=channels`]]} />
      {tab === "rules" ? <Rules /> : tab === "channels" ? <Channels /> : <Log />}
    </>
  );
}

/** Reads [path] again whenever the stream says notices or rules changed; the third value reads it again now (重试). */
function useNotices<T>(path: string): [T | null, string | null, () => void] {
  const { data } = useConsole();
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    api<T>(path).then((next) => { if (current) { setValue(next); setError(null); } }).catch((failure: Error) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [path, data.noticeVersion, attempt]);
  return [value, error, () => { setError(null); setAttempt((n) => n + 1); }];
}

/**
 * The notices, newest first, of all rules or one; the server filters and pages, continuing after the last one shown.
 * A new notice does not throw away what is loaded: the ones already shown are updated in place (their deliveries), and
 * the new ones wait behind 「有 N 条新事件」. A change of filter, or that button, reads the first page again.
 */
function Log() {
  const { data } = useConsole();
  const [rule, setRule] = useState("");
  const [rules] = useNotices<EventRule[]>("/api/notifications/rules");
  const [pages, setPages] = useState<Notice[][]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fresh, setFresh] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const page = (after?: Notice) => api<Notice[]>(`/api/notifications/events?${new URLSearchParams({ ...(rule ? { rule } : {}), ...(after ? { after: `${after.at}:${after.id}` } : {}) })}`);
  // The first page from scratch: on opening, a new filter, 重试, or 有 N 条新事件.
  useEffect(() => {
    let current = true;
    setLoaded(false); setFresh(0);
    page().then((first) => { if (current) { setPages([first]); setMore(first.length === PAGE); setError(null); setLoaded(true); } })
      .catch((failure: Error) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [rule, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Something changed: read the first page and merge it into what is shown.
  const seen = useRef(data.noticeVersion);
  useEffect(() => {
    if (seen.current === data.noticeVersion || !loaded) return;
    seen.current = data.noticeVersion;
    let current = true;
    page().then((first) => {
      if (!current) return;
      setPages((now) => {
        const byId = new Map(first.map((item) => [item.id, item]));
        const shown = new Set(now.flat().map((item) => item.id));
        setFresh(first.filter((item) => !shown.has(item.id)).length);
        return now.map((list) => list.map((item) => byId.get(item.id) ?? item));
      });
    }).catch(() => {});
    return () => { current = false; };
  }, [data.noticeVersion, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const notices = pages.flat();
  const loadMore = async () => {
    setLoadingMore(true);
    try { await orToast(async () => { const next = await page(notices[notices.length - 1]); setPages((now) => [...now, next]); setMore(next.length === PAGE); }); }
    finally { setLoadingMore(false); }
  };
  if (error) return <ErrorCard text={error} retry={() => { setError(null); setAttempt((n) => n + 1); }} />;
  if (!loaded) return <Loading card />;
  return (
    <>
      <div className={s.filter}>
        <TextSelect label="按规则筛选" value={rule} onChange={setRule} options={[["", "全部规则"], ...(rules ?? []).map((item): [string, string] => [item.ruleId, item.name])]} />
      </div>
      {fresh > 0 && <button type="button" className={s.fresh} onClick={() => setAttempt((n) => n + 1)}>有 {fresh} 条新事件 · 查看</button>}
      <Card flush as="section" aria-label="事件记录">
        {notices.length ? notices.map((item) => (
          <article key={item.id} className={s.event}>
            <span className={s.time}>{shortTime(item.at)}</span>
            <div className={s.body}>
              <div className={s.titleLine}><Pill tone={TONES[item.ruleId] ?? ""}>{item.ruleName}</Pill><b>{item.title}</b></div>
              {item.detail && <Muted as="span">{item.detail}</Muted>}
              <div className={s.deliveries}>
                {item.deliveries.length ? item.deliveries.map((delivery) => (
                  <span key={delivery.id} className={s.deliveryLine}><DeliveryPill delivery={delivery} />
                    {delivery.state === "FAILED" && delivery.channelId && <Button small onClick={() => void orToast(() => api(`/api/notifications/deliveries/${enc(delivery.id)}/retry`, { method: "POST", body: {} }), "已重发")}>重发</Button>}
                  </span>
                )) : <Muted as="span" className={s.delivery}>无渠道订阅</Muted>}
              </div>
            </div>
            {item.jobId && <Link to={paths.job(item.jobId)} className={s.open}>战报</Link>}
          </article>
        )) : <Empty>{rule ? "这条规则还没有记下事件" : "还没有事件"}</Empty>}
      </Card>
      {more && <div className={s.more}><Button onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "读取中…" : "加载更多"}</Button></div>}
    </>
  );
}

function Rules() {
  const [rules, error, retry] = useNotices<EventRule[]>("/api/notifications/rules");
  if (error) return <ErrorCard text={error} retry={retry} />;
  if (!rules) return <Loading card />;
  const placed = new Set(GROUPS.flatMap(([, , ids]) => ids));
  const groups: [string, string, EventRule[]][] = GROUPS.map(([name, hint, ids]) => [name, hint, ids.flatMap((id) => rules.filter((rule) => rule.ruleId === id))]);
  const rest = rules.filter((rule) => !placed.has(rule.ruleId));
  if (rest.length) groups.push(["其他", "", rest]);
  return (
    <>
      {groups.filter(([, , list]) => list.length).map(([name, hint, list]) => (
        <Card flush as="section" key={name} aria-label={name}>
          <h2 className={s.groupTitle}>{name}{hint && <Muted as="span"> · {hint}</Muted>}</h2>
          {list.map((rule) => <RuleRow key={rule.ruleId} rule={rule} />)}
        </Card>
      ))}
      <FollowUps />
    </>
  );
}

/** Script events (`上报 事件名`) that automatically queue a follow-up task for the same game account. */
function FollowUps() {
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

/**
 * One rule: its switch, and its threshold or plan results. Turning it on needs a threshold, which starts empty with the
 * suggestion shown as a hint; a change to an enabled rule is saved when the field is left.
 */
function RuleRow({ rule }: { rule: EventRule }) {
  const [threshold, setThreshold] = useState(rule.threshold?.toString() ?? "");
  const [results, setResults] = useState<PlanOutcome[]>(rule.results);
  // Compared by value: the rules are read again on every notice, and a new but equal list must not wipe what is being typed.
  const savedResults = rule.results.join(",");
  useEffect(() => { setThreshold(rule.threshold?.toString() ?? ""); setResults(rule.results); }, [rule.threshold, savedResults]);
  const hasValue = rule.kind === "COUNT" || rule.kind === "DURATION";
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => { if (!hint) return; const timer = window.setTimeout(() => setHint(null), 4000); return () => window.clearTimeout(timer); }, [hint]);
  const save = (enabled: boolean, nextResults = results) => orToast(() => api(`/api/notifications/rules/${enc(rule.ruleId)}`, { method: "PUT",
    body: { enabled, threshold: hasValue && threshold.trim() ? Number(threshold) : null, results: nextResults } }), "已保存");
  const flip = (outcome: PlanOutcome) => {
    const next = results.includes(outcome) ? results.filter((item) => item !== outcome) : [...results, outcome];
    // An enabled rule keeps at least one result: leaving none would show a filter the server does not have.
    if (rule.enabled && !next.length) { setHint("至少留一种结果"); return; }
    setResults(next);
    if (rule.enabled) void save(true, next).then((ok) => { if (!ok) setResults(rule.results); });
  };
  return (
    <Row className={s.rule}>
      <Grow className={s.ruleText}><b>{rule.name}</b><Muted as="span">{rule.description}</Muted></Grow>
      {hasValue && (
        <label className={s.value}>{rule.kind === "COUNT" ? "连续" : "超过"}
          <input inputMode="numeric" value={threshold} placeholder={rule.suggested?.toString() ?? ""} aria-label={`${rule.name}：${rule.kind === "COUNT" ? "连续次数" : "分钟"}`}
            onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))} onBlur={() => {
              if (!rule.enabled) return;
              // An enabled rule needs its threshold: an emptied field goes back to the one in use.
              if (!threshold) setThreshold(rule.threshold?.toString() ?? "");
              else if (Number(threshold) !== rule.threshold) void save(true);
            }} />
          {rule.kind === "COUNT" ? "次" : "分钟"}
        </label>
      )}
      {rule.kind === "RESULT" && (
        <span role="group" aria-label="计划结果" className={s.chips}>
          {OUTCOMES.map(([id, label]) => <button key={id} type="button" className={s.chip} aria-pressed={results.includes(id)} onClick={() => flip(id)}>{label}</button>)}
        </span>
      )}
      {hint && <span className={s.hint} role="alert">{hint}</span>}
      <LiveSwitch checked={rule.enabled} label={`开启规则：${rule.name}`} save={async (on) => {
        // Turning on with the field empty takes the suggestion, shown in the field so the user sees what was set.
        const value = hasValue ? threshold.trim() || rule.suggested?.toString() || "" : "";
        if (on && hasValue && !value) throw new Error("先填写阈值");
        if (hasValue) setThreshold(value);
        await api(`/api/notifications/rules/${enc(rule.ruleId)}`, { method: "PUT",
          body: { enabled: on, threshold: hasValue && value ? Number(value) : null, results } });
      }} />
    </Row>
  );
}

/** The channels, with the rules they can subscribe to. */
function Channels() {
  const [channels, error, retry] = useNotices<Channel[]>("/api/notifications/channels");
  const [rules] = useNotices<EventRule[]>("/api/notifications/rules");
  if (error) return <ErrorCard text={error} retry={retry} />;
  if (!channels || !rules) return <Loading card />;
  return <ChannelList channels={channels} rules={rules} />;
}
