import { api, ApiFailure, apiUrl, enc } from "../../api/client";

/** The /api/admin calls, with the field names of the agreed contract (admin-api.md). Times are epoch milliseconds. */

export type Admin = { userId: string; email: string | null; githubLogin: string | null };

export type CodeStatus = "unused" | "used" | "revoked" | "expired";
export type Person = { userId: string; email: string | null; githubLogin: string | null };
export type Code = {
  id: string; prefix: string; days: number | null; status: CodeStatus; batch: string | null; createdAt: number;
  redeemBy: number | null; redeemedAt: number | null; redeemedBy: Person | null;
};
export type CodeFilter = { status: "all" | CodeStatus; batch: string; days: "" | "forever" | number; q: string };
export type CodePage = {
  total: number;
  counts: { all: number; unused: number; used: number; revoked: number; expired: number };
  /** [unused] leaves out the expired ones. */
  stats: { issued: number; redeemed: number; unused: number; expired: number; redeemed7d: number };
  batches: string[];
  items: Code[];
};
export type NewCodes = { count: number; days: number | null; batch: string | null; redeemBy: number | null };
export type Generated = { codes: string[]; days: number | null; batch: string | null };

export type Tier = "PRO" | "FREE";
export type User = {
  id: string; email: string | null; githubLogin: string | null; tier: Tier; proExpiresAt: number | null;
  devices: number; accounts: number; plans: number; createdAt: number; lastSeenAt: number | null;
};
export type UserFilter = { tier: "all" | "pro" | "free"; q: string };
export type UserPage = { total: number; counts: { all: number; pro: number; free: number }; items: User[] };
export type UserDetail = User & { history: { at: number; kind: "redeem" | "admin"; text: string }[] };

export const PAGE = 50;

const query = (entries: Record<string, string | number>) =>
  Object.entries(entries).filter(([, value]) => value !== "").map(([key, value]) => `${key}=${enc(String(value))}`).join("&");
const codeQuery = (filter: CodeFilter) => query({ status: filter.status, batch: filter.batch, days: filter.days, q: filter.q.trim() });

export const admin = {
  me: () => api<Admin>("/api/admin/me"),
  codes: (filter: CodeFilter, offset: number) => api<CodePage>(`/api/admin/codes?${codeQuery(filter)}&${query({ offset, limit: PAGE })}`),
  generate: (body: NewCodes) => api<Generated>("/api/admin/codes", { method: "POST", body }),
  revoke: (id: string) => api<Code>(`/api/admin/codes/${enc(id)}/revoke`, { method: "POST", body: {} }),
  /** The current filter's codes as the server's CSV (no plaintext), saved as a file. */
  async exportCodes(filter: CodeFilter) {
    let reply: Response;
    try { reply = await fetch(apiUrl(`/api/admin/codes.csv?${codeQuery(filter)}`), { headers: { "X-YYS-Request": "1" }, credentials: "include" }); }
    catch { throw new ApiFailure(0, "network", "无法连接服务器，请检查网络"); }
    if (!reply.ok) {
      const data = await reply.json().catch(() => null);
      throw new ApiFailure(reply.status, data?.code ?? "error", data?.message ?? "导出失败，请稍后再试");
    }
    save(await reply.blob(), `兑换码-${stamp()}.csv`);
  },
  users: (filter: UserFilter, offset: number) => api<UserPage>(`/api/admin/users?${query({ tier: filter.tier, q: filter.q.trim(), offset, limit: PAGE })}`),
  user: (id: string) => api<UserDetail>(`/api/admin/users/${enc(id)}`),
  setTier: (id: string, tier: Tier, expiresAt: number | null) =>
    api<UserDetail>(`/api/admin/users/${enc(id)}/tier`, { method: "PUT", body: { tier, expiresAt } }),
  logout: () => api("/api/auth/logout", { method: "POST", body: {} }),
};

/** Hands the viewer a file to save. */
export function save(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const stamp = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
