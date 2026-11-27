import { useDev } from "./context";
import { referenceSize } from "./GamePage";

/**
 * The one place a picture's pixels and a script's numbers meet. Scripts write positions in the game's reference size
 * (2400 × 1080 unless the game says otherwise); a sample is the phone's screen made 1080 high with its bars cut. As the
 * engine maps a region (ScreenLayout, by height), a picture of another height is scaled by height both ways.
 */
export type Size = [number, number];
export const DEFAULT_REFERENCE: Size = [2400, 1080];

/** The reference size of the open game's draft. */
export function useReference(): Size {
  const { draft, game } = useDev();
  const said = draft ? referenceSize(draft.body, game) : null;
  const m = said ? /(\d+)\s*×\s*(\d+)/.exec(said) : null;
  return m ? [Number(m[1]), Number(m[2])] : DEFAULT_REFERENCE;
}
/** Picture pixels → reference numbers (rounded), for a picture of [picture] size. */
export const toReference = (xs: number[], picture: Size, reference: Size) => { const k = reference[1] / picture[1]; return xs.map((v) => Math.round(v * k)); };
/** Reference numbers → picture pixels (rounded: a picture is read by whole pixels). */
export const toPicture = (xs: number[], picture: Size, reference: Size) => { const k = picture[1] / reference[1]; return xs.map((v) => Math.round(v * k)); };
/** 「画面 2400×1080 · 基准 2400×1080」. */
export const sizesNote = (picture: Size, reference: Size) => `画面 ${picture[0]}×${picture[1]} · 基准 ${reference[0]}×${reference[1]}`;
/** Numbers as a script writes them after @: 「1000,330,320,400」, with the comma the line used. */
export const atText = (xs: number[], comma = ",") => xs.map((v) => String(Math.round(v))).join(comma);
