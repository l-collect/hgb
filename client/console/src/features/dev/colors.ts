import { ApiFailure } from "../../api/client";

/** A picked colour point on a sample, in sample pixels. */
export interface ColorPick { x: number; y: number; hex: string }

/** A few samples' pixels at most (about 10 MB each), the latest used kept. */
const cache = new Map<string, Promise<ImageData>>();
const KEPT = 4;

/** A sample's pixels (fetched once per page), to read colours on it without the phone. */
export function pixelsOf(url: string): Promise<ImageData> {
  let found = cache.get(url);
  if (found) { cache.delete(url); cache.set(url, found); }
  if (!found) {
    found = (async () => {
      let reply: Response;
      try { reply = await fetch(url, { headers: { "X-YYS-Request": "1" }, credentials: "include" }); }
      catch { throw new ApiFailure(0, "network", "无法连接服务器，请检查网络"); }
      if (!reply.ok) throw new ApiFailure(reply.status, "error", "样本图没取到");
      const bitmap = await createImageBitmap(await reply.blob());
      const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    })();
    found.catch(() => cache.delete(url));
    cache.set(url, found);
    while (cache.size > KEPT) cache.delete(cache.keys().next().value!);
  }
  return found;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();

export function colorAt(pixels: ImageData, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return null;
  const i = (y * pixels.width + x) * 4;
  return hex2(pixels.data[i]) + hex2(pixels.data[i + 1]) + hex2(pixels.data[i + 2]);
}

export type ColorAnchor = "auto" | "left" | "center" | "right";

/**
 * Evaluates colour points across aspect-ratio docking shifts (matching ScreenLayout.candidateColorShifts on the phone),
 * returning the lowest worst-channel difference across valid shifts, or null when out of bounds.
 */
export function worstOf(pixels: ImageData, picks: ColorPick[], refW = pixels.width, refH = pixels.height, anchor: ColorAnchor = "auto"): number | null {
  const s = pixels.height / Math.max(1, refH);
  const dW = pixels.width - refW * s;
  const shifts = anchor === "left" ? [0] : anchor === "center" ? [dW / 2] : anchor === "right" ? [dW]
    : Math.abs(dW) < 1 ? [0] : [dW / 2, 0, dW].filter((v, idx, arr) => arr.findIndex((x) => Math.round(x) === Math.round(v)) === idx);
  let best: number | null = null;
  for (const shift of shifts) {
    let worst = 0;
    let ok = true;
    for (const p of picks) {
      const seen = colorAt(pixels, Math.round(p.x * s + shift), Math.round(p.y * s));
      if (!seen) { ok = false; break; }
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(parseInt(seen.slice(c * 2, c * 2 + 2), 16) - parseInt(p.hex.slice(c * 2, c * 2 + 2), 16)));
    }
    if (ok && (best === null || worst < best)) best = worst;
  }
  return best;
}

const ANCHOR_TOKEN: Record<ColorAnchor, string> = { auto: "", left: "左 ", center: "中 ", right: "右 " };

/** The condition as a script writes it. */
export const colorLine = (picks: ColorPick[], tolerance: number, anchor: ColorAnchor = "auto") =>
  `色 ${ANCHOR_TOKEN[anchor]}${picks.map((p) => `${p.x},${p.y}#${p.hex}`).join(" ")} 容差 ${tolerance}`;

/** A set name a script can refer to: no spaces, @, #, commas or quotes. */
export const validSetName = (name: string) => /^[^\s@#,，"“”]{1,32}$/.test(name);
