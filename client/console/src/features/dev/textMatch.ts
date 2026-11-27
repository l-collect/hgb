/** How the server reads a sample's recognized texts against a script's `"字"@区域` (Judge.textSeen, TextCondition). */
/** At least half of [t] lies inside [r], as the server judges a recognized text inside a region (Judge.textSeen). */
export const halfInside = (t: number[], r: number[]) => {
  const [x, y, w, h] = t;
  const ix = Math.max(0, Math.min(x + w, r[0] + r[2]) - Math.max(x, r[0])), iy = Math.max(0, Math.min(y + h, r[1] + r[3]) - Math.max(y, r[1]));
  return w > 0 && h > 0 && 2 * ix * iy >= w * h;
};
/** TextCondition.matches for a script's `"字"@区域` (contains, within a region): the text in the line, or fuzzyContains. */
export const textMatches = (line: string, text: string) => line.includes(text) || (text.length >= 3 && fuzzyContains(line, text));
/** core fuzzyContains: at least 3/4 (and all but one) of [target]'s characters in order inside a span of its length + 1. */
export function fuzzyContains(line: string, target: string): boolean {
  const a = Array.from(line), b = Array.from(target);
  if (b.length < 3 || a.length < b.length - 1) return false;
  const least = Math.max(Math.ceil(b.length * 0.75), b.length - 1);
  for (let start = 0; start < a.length; start++) {
    let matched = 0, ti = 0;
    const limit = Math.min(start + b.length + 1, a.length);
    for (let li = start; li < limit && ti < b.length; li++) {
      const idx = b.indexOf(a[li], ti);
      if (idx >= 0 && idx - ti <= 1) { matched++; ti = idx + 1; }
    }
    if (matched >= least) return true;
  }
  return false;
}
