import { useSavedQueries, type SavedQuery } from '@/composables/useSavedQueries'
import type { RestoreResult } from '@/entityUpgrade'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import posthog from 'posthog-js'
import { defineComponent, ref } from 'vue'

const restoreState = vi.fn<(query: unknown) => Promise<RestoreResult>>()

// Default clean result for restoreState mocks; per-test mocks override this.
const CLEAN_RESTORE_RESULT: RestoreResult = {
  state: { version: 2, small: 1, medium: 0, large: 0, pokemon: ['Pikachu'] },
  unmapped: [],
  upgraded: false,
}

const Host = defineComponent({
  setup() {
    const api = useSavedQueries({
      restoreState,
      small: ref(1),
      medium: ref(0),
      large: ref(0),
      selectedPokemon: ref(['Pikachu']),
      autoSort: ref(true),
    })
    return { api }
  },
  template: '<div />',
})

const STORAGE_KEY = 'pokehousing_saved_queries'

const existing: SavedQuery = {
  title: 'Existing',
  timestamp: 1000,
  small: 1,
  medium: 0,
  large: 0,
  pokemon: ['Pikachu'],
  version: 2,
}

describe('useSavedQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreState.mockResolvedValue(CLEAN_RESTORE_RESULT)
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('loads existing saved queries from localStorage on init', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([existing]))
    const wrapper = mount(Host)
    expect(wrapper.vm.api.savedQueries.value).toEqual([existing])
  })

  it('tolerates a corrupted localStorage payload', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    const wrapper = mount(Host)
    expect(wrapper.vm.api.savedQueries.value).toEqual([])
  })

  it('confirmSave prepends a new entry and persists it', () => {
    const wrapper = mount(Host)
    wrapper.vm.api.queryTitle.value = '  My island  '
    wrapper.vm.api.confirmSave()

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as SavedQuery[]
    expect(saved).toHaveLength(1)
    expect(saved[0]!.title).toBe('My island')
    expect(saved[0]!.small).toBe(1)
    expect(saved[0]!.pokemon).toEqual(['Pikachu'])
    expect(saved[0]!.autoSort).toBe(true)
    expect(wrapper.vm.api.savedQueries.value).toHaveLength(1)
  })

  it('deleteSaved removes and persists immediately, keeping the undo stash', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([existing]))
    const wrapper = mount(Host)

    wrapper.vm.api.deleteSaved(existing.timestamp)

    expect(wrapper.vm.api.savedQueries.value).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([])
    expect(wrapper.vm.api.deletedUndoTitle.value).toBe('Existing')
  })

  it('undoDelete restores the stashed entry at its original position', () => {
    const newer: SavedQuery = { ...existing, title: 'Newer', timestamp: 2000 }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([newer, existing]))
    const wrapper = mount(Host)

    wrapper.vm.api.deleteSaved(existing.timestamp)
    wrapper.vm.api.undoDelete()

    expect(wrapper.vm.api.savedQueries.value.map((q: SavedQuery) => q.timestamp)).toEqual([
      2000, 1000,
    ])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toHaveLength(2)
    expect(wrapper.vm.api.deletedUndoTitle.value).toBe('')
  })

  it('clears the undo stash after the 8s window', () => {
    vi.useFakeTimers()
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([existing]))
      const wrapper = mount(Host)
      wrapper.vm.api.deleteSaved(existing.timestamp)
      expect(wrapper.vm.api.deletedUndoTitle.value).toBe('Existing')

      vi.advanceTimersByTime(8000)

      expect(wrapper.vm.api.deletedUndoTitle.value).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts legacy entries carrying houseIndex/quantity without touching them', () => {
    // The shared restore glue tolerates legacy `houseIndex`/`quantity` fields;
    // this composable must at least round-trip such entries losslessly so the
    // restore path can see them.
    const legacy: SavedQuery = {
      title: 'Legacy',
      timestamp: 3000,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['Pikachu'],
      cart: [{ houseIndex: 0, name: 'Punching Bag', quantity: 2 }],
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([legacy]))
    const wrapper = mount(Host)
    expect(wrapper.vm.api.savedQueries.value).toEqual([legacy])
  })

  it('AC.5 confirmSave tracks island_saved with island counts', () => {
    const wrapper = mount(Host)
    wrapper.vm.api.queryTitle.value = 'My island'
    wrapper.vm.api.confirmSave()
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('island_saved', {
      pokemon_count: 1,
      small: 1,
      medium: 0,
      large: 0,
    })
  })

  it('AC.5 selecting a saved query tracks island_loaded with source saved_query', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([existing]))
    const wrapper = mount(Host)

    wrapper.vm.api.selectedTimestamp.value = existing.timestamp
    await flushPromises()

    expect(restoreState).toHaveBeenCalled()
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('island_loaded', {
      source: 'saved_query',
    })
  })

  it('rewrites the restored entry with canonical names, preserving title/timestamp', async () => {
    const entry: SavedQuery = {
      title: 'Old names',
      timestamp: 5000,
      small: 2,
      medium: 1,
      large: 0,
      pokemon: ['OldMon'],
      cart: [{ houseId: 'S1', name: 'OldItem', quantity: 2 }],
      version: 2,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry]))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    restoreState.mockResolvedValue({
      state: {
        version: 2,
        small: 2,
        medium: 1,
        large: 0,
        pokemon: ['NewMon'],
        cart: [{ houseId: 'S1', name: 'NewItem', quantity: 2 }],
      },
      unmapped: [],
      upgraded: true,
    })

    const wrapper = mount(Host)
    wrapper.vm.api.selectedTimestamp.value = entry.timestamp
    await flushPromises()

    // The persisted copy carries canonical names; identity fields intact.
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as SavedQuery[]
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.title).toBe('Old names')
    expect(persisted[0]!.timestamp).toBe(entry.timestamp)
    expect(persisted[0]!.version).toBe(2)
    expect(persisted[0]!.pokemon).toEqual(['NewMon'])
    expect(persisted[0]!.cart).toEqual([{ houseId: 'S1', name: 'NewItem', quantity: 2 }])
    expect(wrapper.vm.api.savedQueries.value).toHaveLength(1)
    expect(setItem).toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('performs no persistence write when the restore is clean (upgraded: false)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([existing]))
    const before = localStorage.getItem(STORAGE_KEY)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const wrapper = mount(Host)
    wrapper.vm.api.selectedTimestamp.value = existing.timestamp
    await flushPromises()

    expect(restoreState).toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    setItem.mockRestore()
  })

  it('does not throw when the entry is deleted mid-restore (no stale rewrite)', async () => {
    const entry: SavedQuery = { ...existing, timestamp: 7000 }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry]))

    const wrapper = mount(Host)
    restoreState.mockImplementation(async () => {
      // Simulates deleting the entry via the manage modal mid-restore.
      wrapper.vm.api.deleteSaved(entry.timestamp)
      return {
        state: { version: 2, small: 1, medium: 0, large: 0, pokemon: ['NewMon'] },
        unmapped: [],
        upgraded: true,
      }
    })

    await expect(
      Promise.resolve((wrapper.vm.api.selectedTimestamp.value = entry.timestamp)).then(
        flushPromises,
      ),
    ).resolves.toBeDefined()

    // Deletion stands; no resurrection and no persistence write of the entry.
    expect(wrapper.vm.api.savedQueries.value).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([])
    restoreState.mockResolvedValue(CLEAN_RESTORE_RESULT)
  })

  it('fires the deferred unmapped-entity alert for dropped entities, once per restore', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([existing]))
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    restoreState.mockResolvedValue({
      state: { version: 2, small: 1, medium: 0, large: 0, pokemon: ['Pikachu'] },
      unmapped: [
        { type: 'pokemon', name: 'GhostMon' },
        { type: 'item', name: 'GhostItem' },
      ],
      upgraded: true,
    })

    const wrapper = mount(Host)
    wrapper.vm.api.selectedTimestamp.value = existing.timestamp
    await flushPromises()
    expect(alert).not.toHaveBeenCalled() // deferred to a macrotask

    await new Promise((r) => setTimeout(r, 0))
    expect(alert).toHaveBeenCalledTimes(1)
    const body = alert.mock.calls[0]![0] as string
    expect(body).toContain('GhostMon')
    expect(body).toContain('GhostItem')
    expect(body).toContain('Try searching')
    alert.mockRestore()
    restoreState.mockResolvedValue(CLEAN_RESTORE_RESULT)
  })
})
