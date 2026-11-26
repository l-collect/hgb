import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Chips, Empty, join, Message, Pill, SegmentTabs, ui } from "../../../components/ui";
import { navigate, useQuery } from "../../../router";
import { admin, type Tier, type UserDetail, type UserFilter, type UserPage } from "../api";
import { failure } from "../failure";
import { dateInput, day, endOfDay, expiry, MAX_DAYS, since, time, who } from "../format";
import { Pager, Search, Title } from "./parts";
import s from "./pages.module.css";

/** 用户: tier tabs and search, the table, and the chosen person's detail on the right (?user=). */
export function UsersPage({ me }: { me: string }) {
  const [filter, setFilter] = useState<UserFilter>({ tier: "all", q: "" });
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<UserPage | null>(null);
  const [error, setError] = useState("");
  const chosen = useQuery().get("user");
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
        <div className={s.segUsers}>
          <SegmentTabs label="档位" value={filter.tier} onChange={(tier) => change({ tier })}
            items={[["all", `全部 ${counts?.all ?? ""}`], ["pro", `Pro ${counts?.pro ?? ""}`], ["free", `免费 ${counts?.free ?? ""}`]]} />
        </div>
        <span className={s.spacer} />
        <Search value={filter.q} onChange={search} placeholder="搜邮箱、GitHub" />
      </div>
      <Message text={error} />
      <div className={s.split}>
        <div className={s.splitMain}>
          <Card flush>
            <div className={s.scroll}><table className={s.table}>
              <colgroup><col /><col style={{ width: 110 }} /><col style={{ width: 96 }} /><col style={{ width: 64 }} /><col style={{ width: 72 }} /><col style={{ width: 64 }} /><col style={{ width: 96 }} /></colgroup>
              <thead><tr><th>账号</th><th>档位</th><th>到期</th><th>设备</th><th>游戏号</th><th>计划</th><th>注册</th></tr></thead>
              <tbody>
                {page?.items.map((user) => (
                  <tr key={user.id} className={join(s.pick, user.id === chosen && s.picked)}
                    onClick={() => navigate(`/admin/users?user=${encodeURIComponent(user.id)}`, { replace: true })}>
                    <td>
                      <button type="button" className={s.rowButton}><b>{user.email ?? "—"}</b></button>{" "}
                      <span className={ui.tiny}>{user.githubLogin ? `gh:${user.githubLogin}` : ""}</span>
                    </td>
                    <td><TierPill tier={user.tier} /></td>
                    <td className={`${ui.tiny} ${ui.mono}`}>{expiry(user)}</td>
                    <td>{user.devices}</td><td>{user.accounts}</td><td>{user.plans}</td>
                    <td className={`${ui.tiny} ${ui.mono}`}>{day(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {page && page.items.length === 0 && <Empty>没有用户</Empty>}
            {!page && !error && <Empty>正在加载…</Empty>}
          </Card>
          {page && <Pager offset={offset} total={page.total} onChange={setOffset} />}
        </div>
        <div className={s.side}>{chosen ? <Detail key={chosen} id={chosen} self={chosen === me} onSaved={() => void load()} /> : <Card><Empty>点一行看详情</Empty></Card>}</div>
      </div>
    </>
  );
}

const TierPill = ({ tier }: { tier: Tier }) => tier === "PRO" ? <Pill tone="soft">Cloud Pro</Pill> : <Pill>免费</Pill>;

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

  if (!user) return <Card>{error ? <Message text={error} /> : <Empty>正在加载…</Empty>}</Card>;
  return (
    <Card flush>
      <div className={s.detailHead}><b>{who(user)}</b><span className={ui.tiny}>注册 {day(user.createdAt)} · 最近活跃 {since(user.lastSeenAt)}</span></div>
      <div className={s.detailBody}>
        <span className={s.label}>档位</span>
        <Chips label="档位" value={tier} onChange={setTier} disabled={self} items={[["FREE", "免费"], ["PRO", "Pro"]]} />
        <span className={s.label}>到期</span>
        <Chips label="到期" value={forever} onChange={setForever} disabled={self || tier !== "PRO"} items={[["forever", "永久"], ["until", "指定日期"]]} />
        {tier === "PRO" && forever === "until" && <input type="date" aria-label="到期日" className={s.input} value={until} disabled={self} min={dateInput(Date.now())} max={dateInput(Date.now() + MAX_DAYS * 86400000)} onChange={(e) => setUntil(e.target.value)} />}
        <div><Button variant="primary" small onClick={save} disabled={self || busy || (tier === "PRO" && forever === "until" && !until)}>保存</Button></div>
        <Message text={error || saved} ok={!error} />
        <span className={ui.tiny}>{self ? "不能改自己" : "改档位会记一条操作记录"}</span>
      </div>
      <div className={s.historyHead}>兑换与改动</div>
      {user.history.length === 0 && <Empty>还没有记录</Empty>}
      {user.history.map((entry, i) => (
        <div key={i} className={s.historyRow}><span>{entry.text}</span><span className={`${ui.tiny} ${ui.mono}`}>{time(entry.at)}</span></div>
      ))}
    </Card>
  );
}
