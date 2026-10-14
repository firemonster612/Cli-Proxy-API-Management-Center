/** Screen point just under `anchor`, right-aligned to it for a popover `width` wide. */
export function pointUnder(anchor: HTMLElement, width: number): { x: number; y: number } {
  const rect = anchor.getBoundingClientRect();
  return { x: rect.right - width, y: rect.bottom + 6 };
}
