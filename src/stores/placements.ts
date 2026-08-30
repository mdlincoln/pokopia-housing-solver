import { defineStore } from 'pinia'
import { ref } from 'vue'

// Drag-override placements: a single reactive Map keyed by pokemon name whose
// value is a target house id (drag into a house) or `null` (drag into the
// unhoused warning). This store is intentionally NOT serialized — drags are
// session-only, while pins (src/stores/pins.ts) are the only durable placement.
export const usePlacementStore = defineStore('placements', () => {
  const placements = ref(new Map<string, string | null>())

  // A single map entry per name: setting it again implicitly vacates any
  // previous house it occupied (the opposite-move is derived by the display
  // override in HomeView, not stored).
  function set(name: string, target: string | null) {
    placements.value.set(name, target)
  }

  function clear() {
    placements.value.clear()
  }

  function remove(name: string) {
    placements.value.delete(name)
  }

  return { placements, set, clear, remove }
})
