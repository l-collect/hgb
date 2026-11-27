import type { JobEvent } from "../../api/types";

/**
 * The script line a step stopped on, from the last event that has an action: the id the script compiled to names it
 * (`L12w`, `L3_2p`: the number after L is the line). Inside a repeat the id goes on after `#n.` (`L12#0.L13w` is line
 * 13); a call into a snippet (`L83.L4w`) or a handler (`L3w~lost.L1p`) stays at the calling line (83, 3). No action
 * with a line: null, and only the step is opened.
 */
export function lineOf(events: JobEvent[]): number | null {
  for (const event of [...events].reverse()) {
    if (!event.action) continue;
    return lineOfAction(event.action);
  }
  return null;
}

export function lineOfAction(action: string): number | null {
  let line: number | null = null;
  for (const part of action.split(".")) {
    const hit = /^L(\d+)/.exec(part);
    if (!hit) break;
    line = Number(hit[1]);
    // Only a repeat's iteration (#n, before any ~) goes on into the next part.
    const head = part.split("~")[0];
    if (part.includes("~") || !/#\d+$/.test(head)) break;
  }
  return line;
}
