// Saved-island persistence (localStorage) for HomeView. Owns the SavedQuery
// type, the storage key, load/persist, the modal/undo state, and the
// selectedTimestamp → restore watch. Behavior must stay byte-for-byte
// identical (legacy `houseIndex`/`quantity` tolerance lives in restoreState on
// the HomeView side; deleting/undoing must keep the 8s single-slot window).
//
// Restored entries are rewritten in place when restoreState upgraded names
// (tombstoned renames mapped or unmapped entities dropped), title/timestamp
// preserved — so the persisted copy carries canonical names and the
// unmapped-entity alert fires once for a given entry, not on every restore.

import { trackIslandLoaded, trackIslandSaved } from '@/analytics'
import { formatUnmappedAlert, type RestoreResult } from '@/entityUpgrade'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { usePinStore } from '@/stores/pins'
import { useProgressStore } from '@/stores/progress'
import { computed, onUnmounted, ref, watch, type Ref } from 'vue'

export interface SavedQuery {
  title: string
  timestamp: number
  small: number
  medium: number
  large: number
  pokemon: string[]
  autoSort?: boolean
  cart?: Array<{ houseId?: string; houseIndex?: number; name: string; quantity?: number }>
  checkedHouses?: number[]
  checkedPokemon?: string[]
  checkedCartItems?: string[]
  placedItems?: string[]
  pinnedHouses?: string[]
  pinnedPokemon?: string[]
  houseRegistry?: Array<{ id: string; size: string }>
  houseCounters?: Record<string, number>
  version?: number
}

const STORAGE_KEY = 'pokehousing_saved_queries'

export type SharedState = Omit<SavedQuery, 'title' | 'timestamp'>

interface UseSavedQueriesOptions {
  restoreState: (query: SharedState) => Promise<RestoreResult>
  small: Ref<number>
  medium: Ref<number>
  large: Ref<number>
  selectedPokemon: Ref<string[]>
  autoSort: Ref<boolean>
}

export function useSavedQueries({
  restoreState,
  small,
  medium,
  large,
  selectedPokemon,
  autoSort,
}: UseSavedQueriesOptions) {
  const cartStore = useCartStore()
  const pinStore = usePinStore()
  const progressStore = useProgressStore()
  const houseStore = useHouseStore()

  function loadSavedQueries(): SavedQuery[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    } catch {
      return []
    }
  }

  const savedQueries = ref<SavedQuery[]>(loadSavedQueries())
  const selectedTimestamp = ref<number | null>(null)
  const queryTitle = ref('')
  const showSaveModal = ref(false)
  const showManageModal = ref(false)
  const saveSuccess = ref(false)
  const restoringQuery = ref(false)

  // Single-slot undo for saved-island deletions. A second deletion while the
  // undo alert is visible replaces the stash — acceptable for low-stakes
  // localStorage data, and deliberately keeps this from growing into a general
  // undo queue.
  const deletedUndo = ref<{ entry: SavedQuery; index: number } | null>(null)
  const UNDO_WINDOW_MS = 8000
  let undoTimer: ReturnType<typeof setTimeout> | undefined

  const deletedUndoTitle = computed(() => {
    const stash = deletedUndo.value
    if (!stash) return ''
    return stash.entry.title || new Date(stash.entry.timestamp).toLocaleString()
  })

  function persistSavedQueries() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedQueries.value))
  }

  function deleteSaved(timestamp: number) {
    const index = savedQueries.value.findIndex((q) => q.timestamp === timestamp)
    if (index === -1) return
    const entry = savedQueries.value[index]!
    savedQueries.value.splice(index, 1)
    persistSavedQueries()
    // Restoring from the select is one-shot (selectedTimestamp watch); a deleted
    // entry must not linger as the selected value or a later re-select of the
    // same timestamp could trigger a stale restore.
    if (selectedTimestamp.value === timestamp) {
      selectedTimestamp.value = null
    }
    clearTimeout(undoTimer)
    deletedUndo.value = { entry, index }
    undoTimer = setTimeout(() => {
      deletedUndo.value = null
    }, UNDO_WINDOW_MS)
  }

  function undoDelete() {
    clearTimeout(undoTimer)
    const stash = deletedUndo.value
    if (!stash) return
    deletedUndo.value = null
    savedQueries.value.splice(Math.min(stash.index, savedQueries.value.length), 0, stash.entry)
    persistSavedQueries()
  }

  onUnmounted(() => {
    clearTimeout(undoTimer)
  })

  function openSaveModal() {
    queryTitle.value = ''
    showSaveModal.value = true
  }

  function confirmSave() {
    const entry: SavedQuery = {
      title: queryTitle.value.trim(),
      timestamp: Date.now(),
      version: 2,
      small: small.value,
      medium: medium.value,
      large: large.value,
      pokemon: [...selectedPokemon.value],
      autoSort: autoSort.value,
      cart: cartStore.serializedCart,
      ...progressStore.toSerializable(),
      ...pinStore.toSerializable(),
      ...houseStore.toSerializable(),
    }
    savedQueries.value = [entry, ...savedQueries.value]
    persistSavedQueries()
    trackIslandSaved({
      pokemon_count: selectedPokemon.value.length,
      small: small.value,
      medium: medium.value,
      large: large.value,
    })
    saveSuccess.value = true
    setTimeout(() => {
      saveSuccess.value = false
    }, 3000)
  }

  // Enter in the modal title input saves and closes exactly once. The modal's
  // own @ok handler still fires for button clicks; closing explicitly here
  // prevents the modal from also treating Enter as a default action.
  function onSaveEnter() {
    confirmSave()
    showSaveModal.value = false
  }

  watch(selectedTimestamp, async (ts) => {
    if (ts === null) return
    const query = savedQueries.value.find((q) => q.timestamp === ts)
    if (!query) return
    restoringQuery.value = true
    try {
      const result = await restoreState(query)

      // Upgraded restore: rewrite the persisted entry in place with the
      // canonical names (title/timestamp preserved) so the stored copy stops
      // carrying dropped/stale names and the alert fires once, not on every
      // future restore of the same entry. The entry is re-located by
      // timestamp rather than remembered by index — the manage modal may have
      // deleted it mid-restore.
      if (result.upgraded) {
        const index = savedQueries.value.findIndex((q) => q.timestamp === ts)
        if (index !== -1) {
          savedQueries.value[index] = { ...savedQueries.value[index]!, ...result.state }
          persistSavedQueries()
        }
      }

      trackIslandLoaded({ source: 'saved_query' })

      // Deferred to a macrotask so the restored island is visible behind the
      // native dialog when entities had to be dropped.
      if (result.unmapped.length > 0) {
        setTimeout(() => window.alert(formatUnmappedAlert(result.unmapped)), 0)
      }
    } finally {
      restoringQuery.value = false
    }
  })

  return {
    savedQueries,
    selectedTimestamp,
    queryTitle,
    showSaveModal,
    showManageModal,
    saveSuccess,
    restoringQuery,
    deletedUndoTitle,
    openSaveModal,
    confirmSave,
    deleteSaved,
    undoDelete,
    onSaveEnter,
  }
}
