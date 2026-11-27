import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Chips, Empty, join, Message, SegmentTabs } from "../../../components/ui";
import { navigate, useQuery } from "../../../router";
import { admin, type Tier, type UserDetail, type UserFilter, type UserPage } from "../api";
import { failure } from "../failure";
import { dateInput, day, endOfDay, expiry, MAX_DAYS, since, time, who } from "../format";
import { NextIcon, UserIcon } from "../icons";
import { Pager, Search, TabsRow, Title } from "./parts";
import s from "./pages.module.css";

/** 用户: tier tabs and search, the table, and the chosen person's detail on the right (?user=). */
export function UsersPage({ me }: { me: string }) {
  const [filter, setFilter] = useState<UserFilter>({ tier: "all", q: "" });
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<UserPage | null>(null);
  const [error, setError] = useState("");
  const chosen = useQuery().get("user");
  // Narrow, the detail sits under the list: a row tapped there brings it into view (at once when motion is reduced).
  const side = useRef<HTMLDivElement>(null);
  const tapped = useRef(false);
  useEffect(() => {
    if (!chosen || !tapped.current) return;
    tapped.current = false;
    if (!matchMedia("(max-width: 599px)").matches) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    side.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, [chosen]);
  const change = (next: Partial<UserFilter>) => { setFilter((current) => ({ ...current, ...next })); setOffset(0); };
  const search = useCallback((q: string) => change({ q }), []);

  // Only the latest request's answer is shown: an older one arriving late (a slow search) is dropped.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try { const next = await admin.users(filter, offset); if (ticket === latest.current) { setPage(next); setError(""); } }
    catch (e) { if (ticket === latest.current) setError(failure(e)); }
  }, [filter, offset]);
  useEffect(() => { void load(); }, [load]);

  const counts = page?.counts;
  return (
    <>
      <Title>用户</Title>
      <div className={s.filters}>
        <TabsRow>
          <SegmentTabs label="档位" value={filter.tier} onChange={(tier) => change({ tier })}
            items={[["all", `全部 ${counts?.all ?? ""}`], ["pro", `${PRO} ${counts?.pro ?? ""}`], ["free", `${FREE} ${counts?.free ?? ""}`]]} />
        </TabsRow>
        <span className={s.spacer} />
        <Search value={filter.q} onChange={search} placeholder="搜邮箱、GitHub" />
      </div>
      <Message text={error} />
      <div className={s.split}>
        <div className={s.splitMain}>
          <Card flush>
            <div className={s.tableWrap}><table className={join(s.table, s.users)}>
              <colgroup><col /><col style={{ width: 104 }} /><col style={{ width: 72 }} /><col style={{ width: 52 }} /><col style={{ width: 60 }} /><col style={{ width: 52 }} /><col style={{ width: 72 }} /></colgroup>
              <thead><tr><th>账号</th><th>档位</th><th>到期</th><th>设备</th><th>游戏号</th><th>计划</th><th>注册</th></tr></thead>
              <tbody>
                {page?.items.map((user) => (
                  <tr key={user.id} className={join(s.pickRow, user.id === chosen && s.picked)}
                    onClick={() => navigate(`/admin/users?user=${encodeURIComponent(user.id)}`, { replace: true })}>
                    <td>
                      <button type="button" className={s.rowButton} aria-current={user.id === chosen ? "true" : undefined}>{user.email ?? (user.githubLogin ? `gh:${user.githubLogin}` : "—")}</button>
                      {user.email && user.githubLogin && <span className={s.sub}>gh:{user.githubLogin}</span>}
                    </td>
                    <td><TierPill tier={user.tier} /></td>
                    <td className={join(s.mono, s.muted)}>{expiry(user)}</td>
                    <td>{user.devices}</td><td>{user.accounts}</td><td>{user.plans}</td>
                    <td className={join(s.mono, s.muted)}>{day(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {/* Narrow: a row per person, their tier, expiry and devices under the name; tapping one shows them below. */}
            <div className={s.rows}>
              {page?.items.map((user) => (
                <button key={user.id} type="button" className={join(s.row, user.id === chosen && s.rowOn)} aria-current={user.id === chosen ? "true" : undefined}
                  onClick={() => { tapped.current = true; navigate(`/admin/users?user=${encodeURIComponent(user.id)}`, { replace: true }); }}>
                  <span className={s.tile}><UserIcon /></span>
                  <span className={s.rowText}><span className={s.rowName}>{who(user)}</span>
                    <span className={s.sub}>{user.tier === "PRO" ? `${PRO} · ${user.proExpiresAt == null ? "永久" : `到期 ${expiry(user)}`}` : FREE} · {user.devices} 台设备</span></span>
                  <span className={s.muted}><NextIcon /></span>
                </button>
              ))}
            </div>
            {page && page.items.length === 0 && <Empty>没有用户</Empty>}
            {!page && !error && <Empty>读取中…</Empty>}
          </Card>
          {page && <Pager offset={offset} total={page.total} onChange={setOffset} />}
        </div>
        <div ref={side} className={s.side}>{chosen ? <Detail key={chosen} id={chosen} self={chosen === me} onSaved={() => void load()} /> : <Card><Empty>点一行看详情</Empty></Card>}</div>
      </div>
    </>
  );
}

/** The two tiers, named the same in the tabs, the table and the detail. */
const PRO = "Cloud Pro"; const FREE = "免费";
const TierPill = ({ tier }: { tier: Tier }) => <span className={join(s.tier, tier === "PRO" && s.tierPro)}>{tier === "PRO" ? PRO : FREE}</span>;

/** One person: change their tier by hand (免费 / Pro, 永久 or until a day), then their redeems and changes, newest first. */
function Detail({ id, self, onSaved }: { id: string; self: boolean; onSaved: () => void }) {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState("");
  const [tier, setTier] = useState<Tier>("FREE");
  const [forever, setForever] = useState<"forever" | "until">("forever");
  const [until, setUntil] = useState(() => dateInput(Date.now() + 30 * 86400000));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  const show = (next: UserDetail) => {
    setUser(next); setTier(next.tier);
    setForever(next.tier === "PRO" && next.proExpiresAt != null ? "until" : "forever");
    if (next.tier === "PRO" && next.proExpiresAt != null) setUntil(dateInput(next.proExpiresAt));
  };
  useEffect(() => { admin.user(id).then(show).catch((e) => setError(failure(e))); }, [id]);

  const save = async () => {
    setBusy(true); setError(""); setSaved("");
    try {
      show(await admin.setTier(id, tier, tier === "PRO" && forever === "until" ? endOfDay(until) : null));
      setSaved("已保存"); onSaved();
    } catch (e) { setError(failure(e)); } finally { setBusy(false); }
  };

  if (!user) return <Card>{error ? <Message text={error} /> : <Empty>读取中…</Empty>}</Card>;
  return (
    <Card flush>
      <div className={s.detailHead}><b>{who(user)}</b><span>注册 {day(user.createdAt)} · 最近活跃 {since(user.lastSeenAt)}</span></div>
      <div className={s.detailBody}>
        <div className={s.group}><span className={s.label}>档位</span>
          <Chips label="档位" value={tier} onChange={setTier} disabled={self} items={[["FREE", FREE], ["PRO", PRO]]} /></div>
        <div className={s.group}><span className={s.label}>到期</span>
          <Chips label="到期" value={forever} onChange={setForever} disabled={self || tier !== "PRO"} items={[["forever", "永久"], ["until", "指定日期"]]} />
          {tier === "PRO" && forever === "until" && <input type="date" aria-label="到期日" className={s.input} value={until} disabled={self} min={dateInput(Date.now())} max={dateInput(Date.now() + MAX_DAYS * 86400000)} onChange={(e) => setUntil(e.target.value)} />}</div>
        {/* Saving one's own tier is refused by the server too; the button says why instead of a line under it. */}
        {/* One's own tier: the button stays focusable so a screen reader still hears why it does nothing. */}
        <div><Button variant="primary" className={self ? s.inert : undefined} aria-disabled={self || undefined} onClick={self ? undefined : save}
          disabled={busy || (tier === "PRO" && forever === "until" && !until)}>{self ? "不能改自己" : "保存"}</Button></div>
        <Message text={error || saved} ok={!error} />
      </div>
      <div className={s.historyHead}>兑换与改动</div>
      {user.history.length === 0 && <Empty>还没有记录</Empty>}
      {user.history.map((entry, i) => (
        <div key={i} className={s.historyRow}><span>{entry.text}</span><span className={join(s.mono, s.muted)}>{time(entry.at)}</span></div>
      ))}
    </Card>
  );
}
