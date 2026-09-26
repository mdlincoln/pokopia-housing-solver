// Pointer-event drag gesture for HomeView (drag pokemon between houses and the
// unhoused warning while auto-sort is OFF). The pure hit-test seam lives in
// src/composables/usePokemonDrag.ts (`DRAG_THRESHOLD_PX`, `resolveDropTarget`).
// This composable owns the armed-drag state, selection lock, and pointer
// handlers; the caller binds the four handlers on the results `<section>` and
// supplies the four capability hooks (isEnabled / getHouse / setPlacement /
// isResidentLocked).

import { DRAG_THRESHOLD_PX, resolveDropTarget, type DropTarget } from '@/composables/usePokemonDrag'
import { ref } from 'vue'

interface HouseInfo {
  capacity: number
  pokemon: string[]
}

interface UseDragGestureOptions {
  isEnabled: () => boolean
  getHouse: (houseId: string) => HouseInfo | undefined
  setPlacement: (name: string, target: string | null) => void
  // Lock guard for the full-house swap: a locked (pinned) resident must never
  // be displaced by another card's drag gesture.
  isResidentLocked?: (houseId: string, name: string) => boolean
}

export function useDragGesture({
  isEnabled,
  getHouse,
  setPlacement,
  isResidentLocked = () => false,
}: UseDragGestureOptions) {
  const dragOverTarget = ref<DropTarget | null>(null)
  // The resident card currently under the pointer during a hover. Tracked
  // separately from dragOverTarget because sameTarget only gates on house
  // identity — while sweeping across several resident cards inside one house,
  // the occupant must refresh on every move (the drop highlight follows the
  // card, not the house).
  const dragOverOccupant = ref<string | null>(null)
  // The armed drag's origin house (null when the drag started in the unhoused
  // grid). Exposed so the caller can suppress the swap affordance on the drag's
  // own house — a same-house drop is a no-op, so highlighting a housemate card
  // as a swap counterpart would advertise something that never happens.
  const dragFromHouseId = ref<string | null>(null)
  const draggingName = ref<string | null>(null)
  const dragPos = ref<{ x: number; y: number } | null>(null)

  interface ArmedDrag {
    pointerId: number
    el: HTMLElement
    name: string
    fromHouseId: string | null
    started: boolean
    startX: number
    startY: number
  }

  let armed: ArmedDrag | null = null

  // While an active drag is underway the pointer sweeps across cards and other
  // text, which the browser would otherwise turn into a giant clipboard selection.
  // Lock user-select for the duration of the drag only, and clear any partial
  // selection that started before the threshold — deliberate text selection
  // outside a drag is untouched.
  function setDragSelectionLock(active: boolean) {
    const style = document.body.style
    style.userSelect = active ? 'none' : ''
    style.webkitUserSelect = active ? 'none' : ''
    if (active) window.getSelection()?.removeAllRanges()
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      !!target.closest('button, input, a, [role="checkbox"], [role="combobox"]')
    )
  }

  function onPointerDown(e: PointerEvent) {
    if (armed) return
    const target = e.target
    if (!(target instanceof Element)) return
    const el = target.closest('[data-drag-source]') as HTMLElement | null
    if (!el) return
    if (el.dataset.draggable !== 'true') return
    if (!isEnabled()) return
    if (isInteractiveTarget(target)) return
    // The move gesture (and its affordance) lives solely on the header's move-arrow
    // icon — pressing anywhere else on the card (name, image, favorites) must not
    // arm a drag.
    if (!target.closest('.pokemon-drag-handle')) return

    armed = {
      pointerId: e.pointerId,
      el,
      name: el.dataset.dragName ?? '',
      fromHouseId: el.dataset.fromHouse || null,
      started: false,
      startX: e.clientX,
      startY: e.clientY,
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!armed || e.pointerId !== armed.pointerId) return

    if (!armed.started) {
      if (Math.hypot(e.clientX - armed.startX, e.clientY - armed.startY) <= DRAG_THRESHOLD_PX) {
        return
      }
      armed.started = true
      try {
        armed.el.setPointerCapture(armed.pointerId)
      } catch {
        // jsdom / non-supporting environments proceed without capture; the real
        // pointer path is exercised end-to-end.
      }
      setDragSelectionLock(true)
      draggingName.value = armed.name
      dragFromHouseId.value = armed.fromHouseId
      dragPos.value = { x: e.clientX, y: e.clientY }
      armed.el.classList.add('pokemon-card--dragging')
    }

    dragPos.value = { x: e.clientX, y: e.clientY }
    const t = resolveDropTarget(e.clientX, e.clientY)
    if (!sameTarget(t, dragOverTarget.value)) dragOverTarget.value = t
    // Occupant freshness is deliberately not gated by sameTarget: unlike the
    // zone-level highlight, the swappable-card highlight tracks whichever card
    // is under the pointer right now — a house resident or an unhoused card.
    dragOverOccupant.value = t?.occupant ?? null
  }

  function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
    if (a === b) return true
    if (a === null || b === null) return false
    if (a.type !== b.type) return false
    return (
      a.type === 'unhoused' || (a.type === 'house' && b.type === 'house' && a.houseId === b.houseId)
    )
  }

  // Drops never touch pinStore — only the ephemeral placement override.
  function applyDrop(name: string, fromHouseId: string | null, target: DropTarget | null) {
    if (target === null) return // released over empty space: cancel the move
    if (target.type === 'unhoused') {
      // Dropping onto a specific unhoused card swaps it into the drag's origin
      // house while the dragged pokemon takes the unhoused slot — only for a
      // drag that started in a house; an unhoused-origin drag has nothing to
      // swap with and its placement is already unhoused. Unhoused cards carry no
      // pin control and every pinned name is rendered in its pinned house by the
      // flows that write pins, so there is no lock to honour here (a
      // hand-authored hash that pins a name with no house could still display
      // one unhoused — degenerate, not reachable through the UI).
      const { occupant } = target
      if (occupant && occupant !== name && fromHouseId !== null) {
        setPlacement(occupant, fromHouseId)
        setPlacement(name, null)
        return
      }
      if (fromHouseId === null) return // already unhoused: nothing to record
      setPlacement(name, null)
      return
    }
    // Dropping back onto — or onto a resident card of — the drag's own house is
    // a no-op: no override churn, no housemate displacement.
    if (target.houseId === fromHouseId) return
    // The caller's getHouse already carries capacity + this render's
    // post-override occupants.
    const house = getHouse(target.houseId)
    if (!house) return
    // A specific, valid, unlocked resident card under the pointer swaps — at any
    // capacity. So dropping onto a resident of a house that still has room
    // exchanges the two and leaves the vacant slot vacant, instead of merely
    // filling it. Locks are never overridden by another card's gesture.
    const { occupant } = target
    if (
      occupant &&
      occupant !== name &&
      house.pokemon.includes(occupant) &&
      !isResidentLocked(target.houseId, occupant)
    ) {
      // The displaced resident moves into the drag's origin — its house when the
      // drag started there, the unhoused area when the drag originated in the
      // unhoused grid (fromHouseId === null). Slot math: the dragged name is a
      // member of the origin house's displayed roster (its card's
      // `data-from-house` is bound to the house it is rendered in), so the
      // removal pass always frees exactly one slot there and no house ends over
      // capacity. Override entries are order-independent (each removes its name
      // from every house before appending to its target).
      setPlacement(occupant, fromHouseId)
      setPlacement(name, target.houseId)
      return
    }
    // No swappable resident under the pointer: append when the house has room,
    // otherwise stay blocked (a drop into the card-free area of a full house —
    // title, padding, recommendations panel — moves nothing).
    const residents = house.pokemon.filter((n) => n !== name)
    if (residents.length >= house.capacity) return
    setPlacement(name, target.houseId)
  }

  function resetDrag() {
    if (armed) {
      armed.el.classList.remove('pokemon-card--dragging')
      if (armed.started) {
        try {
          if (armed.el.hasPointerCapture?.(armed.pointerId)) {
            armed.el.releasePointerCapture(armed.pointerId)
          }
        } catch {
          // ignore release failures
        }
      }
    }
    armed = null
    draggingName.value = null
    dragFromHouseId.value = null
    dragPos.value = null
    dragOverTarget.value = null
    dragOverOccupant.value = null
    setDragSelectionLock(false)
  }

  function onPointerUp(e: PointerEvent) {
    if (!armed || e.pointerId !== armed.pointerId) return
    const name = armed.name
    const fromHouseId = armed.fromHouseId
    const started = armed.started
    // Resolve while the dragged card is still pointer-events:none so the zone is
    // whatever sits beneath the pointer, not the ghost or the card itself.
    const target = started ? resolveDropTarget(e.clientX, e.clientY) : null
    resetDrag()
    if (started && name) applyDrop(name, fromHouseId, target)
  }

  // A cancelled pointer (scroll/system gesture took over the pointer) must never
  // relocate the card — just tear the drag down.
  function onPointerCancel(e: PointerEvent) {
    if (!armed || e.pointerId !== armed.pointerId) return
    resetDrag()
  }

  return {
    dragOverTarget,
    dragOverOccupant,
    dragFromHouseId,
    draggingName,
    dragPos,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}
