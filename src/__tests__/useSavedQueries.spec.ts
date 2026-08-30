import { useSavedQueries, type SavedQuery } from '@/composables/useSavedQueries'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'

const restoreState = vi.fn<(query: unknown) => Promise<void>>()

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
    restoreState.mockResolvedValue(undefined)
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
})
