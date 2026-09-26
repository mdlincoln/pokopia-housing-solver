// Pointer-event drag support for HomeView (drag pokemon between houses and the
// unhoused warning while auto-sort is OFF). Kept as a pure seam so the threshold
// and drop-target resolution are unit-testable without jsdom layout / pointer
// capture — the gesture wiring lives in HomeView, and the real pointer path is
// covered end-to-end by Playwright.

/** Pointer movement (px) required before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 6

export type DropTarget =
  | { type: 'house'; houseId: string; occupant: string | null }
  | { type: 'unhoused'; occupant: string | null }

/**
 * Name of the pokemon card the pointer sits on inside `zone`, or null when the
 * pointer is over the zone's non-card area (title, padding, recommendations
 * panel). The dragged card and its ghost never qualify — both are
 * `pointer-events: none` during the drag — and a card from a different
 * (non-contained) zone is never accepted.
 */
function residentIn(zone: HTMLElement, els: Element[]): string | null {
  for (const el of els) {
    const card = el.closest('[data-drag-source]') as HTMLElement | null
    if (card && zone.contains(card)) return card.dataset.dragName ?? null
  }
  return null
}

/**
 * Resolve the drop zone under a viewport point by walking the full hit-test
 * stack (not just the topmost element), so an opaque child inside a house card
 * still resolves to that house. Returns the first zone found, or null.
 *
 * `occupant` names the specific pokemon card under the pointer — the resident of
 * a house, or a pokemon in the unhoused grid — so a drop can swap with it rather
 * than only filling a free slot.
 */
export function resolveDropTarget(x: number, y: number): DropTarget | null {
  const els = document.elementsFromPoint(x, y)
  for (const el of els) {
    const zone = el.closest('[data-drop-zone]') as HTMLElement | null
    if (!zone) continue
    if (zone.dataset.dropZone === 'house') {
      return {
        type: 'house',
        houseId: zone.dataset.dropHouse ?? '',
        occupant: residentIn(zone, els),
      }
    }
    if (zone.dataset.dropZone === 'unhoused') {
      return { type: 'unhoused', occupant: residentIn(zone, els) }
    }
  }
  return null
}
