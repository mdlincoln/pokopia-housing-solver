// Pointer-event drag gesture for HomeView (drag pokemon between houses and the
// unhoused warning while auto-sort is OFF). The pure hit-test seam lives in
// src/composables/usePokemonDrag.ts (`DRAG_THRESHOLD_PX`, `resolveDropTarget`).
// This composable owns the armed-drag state, selection lock, and pointer
// handlers; the caller binds the four handlers on the results `<section>` and
// supplies the three capability hooks (isEnabled / getHouse / setPlacement).

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
}

export function useDragGesture({ isEnabled, getHouse, setPlacement }: UseDragGestureOptions) {
  const dragOverTarget = ref<DropTarget | null>(null)
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
      dragPos.value = { x: e.clientX, y: e.clientY }
      armed.el.classList.add('pokemon-card--dragging')
    }

    dragPos.value = { x: e.clientX, y: e.clientY }
    const t = resolveDropTarget(e.clientX, e.clientY)
    if (!sameTarget(t, dragOverTarget.value)) dragOverTarget.value = t
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
  function applyDrop(name: string, target: DropTarget | null) {
    if (target === null) return // released over empty space: cancel the move
    if (target.type === 'unhoused') {
      setPlacement(name, null)
      return
    }
    // House target: block a drop into a full house. The caller's getHouse
    // already carries capacity + this render's post-override occupants.
    const house = getHouse(target.houseId)
    if (!house) return
    const occupants = house.pokemon.filter((n) => n !== name)
    if (occupants.length >= house.capacity) return
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
    dragPos.value = null
    dragOverTarget.value = null
    setDragSelectionLock(false)
  }

  function onPointerUp(e: PointerEvent) {
    if (!armed || e.pointerId !== armed.pointerId) return
    const name = armed.name
    const started = armed.started
    // Resolve while the dragged card is still pointer-events:none so the zone is
    // whatever sits beneath the pointer, not the ghost or the card itself.
    const target = started ? resolveDropTarget(e.clientX, e.clientY) : null
    resetDrag()
    if (started && name) applyDrop(name, target)
  }

  // A cancelled pointer (scroll/system gesture took over the pointer) must never
  // relocate the card — just tear the drag down.
  function onPointerCancel(e: PointerEvent) {
    if (!armed || e.pointerId !== armed.pointerId) return
    resetDrag()
  }

  return {
    dragOverTarget,
    draggingName,
    dragPos,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}
