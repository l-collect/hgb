import { useSyncExternalStore } from "react";
import { BREAKPOINT } from "../theme/tokens";

/**
 * The desktop widths of the design (网页桌面 · 断点): from BREAKPOINT.wide (1024) lists and details sit side by side,
 * and from DESK (1280) a third column holds the context. Below wide the pages stay one screen at a time, as on the App.
 * Media queries in CSS repeat these numbers, since they cannot read variables.
 */
export const DESK = 1280;

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => { const list = matchMedia(query); list.addEventListener("change", listener); return () => list.removeEventListener("change", listener); },
    () => matchMedia(query).matches,
    () => false,
  );
}
/** ≥1024: list and detail side by side, tables, drawers. */
export const useWide = () => useMedia(`(min-width: ${BREAKPOINT.wide}px)`);
/** ≥1280: the third column (context) beside the detail. */
export const useDesk = () => useMedia(`(min-width: ${DESK}px)`);
