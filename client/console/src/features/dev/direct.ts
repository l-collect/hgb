import { api, ApiFailure, apiUrl, enc } from "../../api/client";

/**
 * The phone's screen seen directly (WebRTC), not through the server, which only passes the two session descriptions.
 * Over a data channel the page writes "next"; the phone answers with the JPEG in binary pieces, then "end <bytes>" (or
 * "none <why>"). One picture at a time: the next is asked only once the last has come.
 */
export interface DirectScreen {
  /** The next picture as an object URL (revoke it when replaced). */
  next(): Promise<string>;
  close(): void;
}

const wait = <T>(ms: number, what: string, work: Promise<T>) => Promise.race([work,
  new Promise<T>((_, reject) => setTimeout(() => reject(new Error(what)), ms))]);

export async function openDirect(device: string): Promise<DirectScreen> {
  const ice = await api<string[]>("/api/dev/rtc/ice");
  const pc = new RTCPeerConnection({ iceServers: [{ urls: ice }] });
  try {
    const channel = pc.createDataChannel("screen", { ordered: true });
    channel.binaryType = "arraybuffer";
    await pc.setLocalDescription(await pc.createOffer());
    // Every candidate in the one offer (no trickling): a few seconds at most, then whatever was found.
    await wait(4000, "", new Promise<void>((done) => {
      if (pc.iceGatheringState === "complete") return done();
      pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") done(); });
    })).catch(() => undefined);
    let reply: Response;
    try {
      reply = await fetch(apiUrl(`/api/dev/devices/${enc(device)}/rtc`), { method: "POST", headers: { "X-YYS-Request": "1", "Content-Type": "text/plain" },
        body: pc.localDescription!.sdp, credentials: "include" });
    } catch { throw new ApiFailure(0, "network", "无法连接服务器，请检查网络"); }
    if (!reply.ok) { const data = await reply.json().catch(() => null); throw new ApiFailure(reply.status, data?.code ?? "error", data?.message ?? "手机没有应答"); }
    await pc.setRemoteDescription({ type: "answer", sdp: await reply.text() });
    await wait(10_000, "直连没打通（网络不允许直连）", new Promise<void>((done, fail) => {
      if (channel.readyState === "open") return done();
      channel.addEventListener("open", () => done());
      channel.addEventListener("close", () => fail(new Error("直连被关闭")));
    }));
    let pieces: ArrayBuffer[] = [];
    let pending: { done: (url: string) => void; fail: (e: Error) => void } | null = null;
    channel.addEventListener("message", (e) => {
      if (e.data instanceof ArrayBuffer) { pieces.push(e.data); return; }
      const text = String(e.data);
      const waiting = pending; pending = null;
      if (text.startsWith("end ")) { const url = URL.createObjectURL(new Blob(pieces, { type: "image/jpeg" })); pieces = []; if (waiting) waiting.done(url); else URL.revokeObjectURL(url); }
      else if (text.startsWith("none")) { pieces = []; waiting?.fail(new Error(`手机没截成：${text.slice(5)}`)); }
    });
    channel.addEventListener("close", () => { pending?.fail(new Error("直连断了")); pending = null; });
    return {
      next: () => {
        if (channel.readyState !== "open") return Promise.reject(new Error("直连断了"));
        return wait(15_000, "直连 15 秒没回画面", new Promise<string>((done, fail) => { pending = { done, fail }; pieces = []; channel.send("next"); }));
      },
      close: () => { channel.close(); pc.close(); },
    };
  } catch (error) { pc.close(); throw error; }
}
