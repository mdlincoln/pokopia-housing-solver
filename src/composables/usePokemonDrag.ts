// Pointer-event drag support for HomeView (drag pokemon between houses and the
// unhoused warning while auto-sort is OFF). Kept as a pure seam so the threshold
// and drop-target resolution are unit-testable without jsdom layout / pointer
// capture — the gesture wiring lives in HomeView, and the real pointer path is
// covered end-to-end by Playwright.

/** Pointer movement (px) required before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 6

export type DropTarget = { type: 'house'; houseId: string } | { type: 'unhoused' }

/**
 * Resolve the drop zone under a viewport point by walking the full hit-test
 * stack (not just the topmost element), so an opaque child inside a house card
 * still resolves to that house. Returns the first zone found, or null.
 */
export function resolveDropTarget(x: number, y: number): DropTarget | null {
  const els = document.elementsFromPoint(x, y)
  for (const el of els) {
    const zone = el.closest('[data-drop-zone]') as HTMLElement | null
    if (!zone) continue
    if (zone.dataset.dropZone === 'house') {
      return { type: 'house', houseId: zone.dataset.dropHouse ?? '' }
    }
    if (zone.dataset.dropZone === 'unhoused') {
      return { type: 'unhoused' }
    }
  }
  return null
}
