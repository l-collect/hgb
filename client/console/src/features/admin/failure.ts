import { ApiFailure } from "../../api/client";

/** Raised by a page whose call came back 401 or 403: the session ended or is no longer an admin's, so ask again. */
export const AUTH_LOST = "admin:auth-lost";
/** A failed call's text for the user; a lost session also sends the whole admin back to its gate. */
export function failure(error: unknown): string {
  if (error instanceof ApiFailure && (error.status === 401 || error.status === 403)) window.dispatchEvent(new Event(AUTH_LOST));
  if (error instanceof ApiFailure && FALLBACK[error.code] && (!error.message || error.message === "操作失败，请稍后再试")) return FALLBACK[error.code];
  return error instanceof Error ? error.message : "操作失败，请稍后再试";
}
/** Words for the contract's codes when the server sends no message of its own. */
const FALLBACK: Record<string, string> = {
  invalid_request: "填写的内容不对，请检查后再试", not_found: "找不到了，可能已被删除", rate_limited: "操作太频繁，请稍后再试", code_used: "已兑换的码不能作废", self: "不能改自己",
};
