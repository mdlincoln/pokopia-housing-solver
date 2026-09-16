// Unit tests for src/analytics.ts: the event catalog and every typed wrapper.
// The posthog-js singleton is globally mocked in setup.ts — the same vi.fn
// identities asserted here are what the integration specs (HomeView, cart,
// useSavedQueries, OnboardingTour, HouseRecommendations) verify flow through
// each user-action choke point.

import * as analytics from '@/analytics'
import posthog from 'posthog-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('posthog mock resolution (Phase-0 smoke gate)', () => {
  it('registers the mocked posthog surface with the identities specs rely on', () => {
    expect(vi.mocked(posthog.capture)).toBeTypeOf('function')
    expect(vi.mocked(posthog.init)).toBeDefined()
    expect(vi.mocked(posthog.captureException)).toBeDefined()
  })
})

describe('ANALYTICS_EVENTS catalog', () => {
  it('is unique and snake_case', () => {
    const values = Object.values(analytics.ANALYTICS_EVENTS)
    expect(values.length).toBeGreaterThan(0)
    expect(new Set(values).size).toBe(values.length)
    for (const key of Object.keys(analytics.ANALYTICS_EVENTS)) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*$/)
    }
    for (const value of values) {
      expect(value).toMatch(/^[a-z0-9_]+$/)
    }
  })
})

describe('track wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trackAppLanded maps to app_landed with arrival_source', () => {
    analytics.trackAppLanded('direct')
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('app_landed', {
      arrival_source: 'direct',
    })
    vi.mocked(posthog.capture).mockClear()
    analytics.trackAppLanded('shared_link')
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('app_landed', {
      arrival_source: 'shared_link',
    })
  })

  it('trackSharedLinkOpened maps to shared_link_opened with island counts', () => {
    analytics.trackSharedLinkOpened({ pokemon_count: 13, small: 1, medium: 3, large: 2 })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('shared_link_opened', {
      pokemon_count: 13,
      small: 1,
      medium: 3,
      large: 2,
    })
  })

  it('trackTourStarted maps to tour_started with no properties', () => {
    analytics.trackTourStarted()
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('tour_started', undefined)
  })

  it('trackTourCompleted maps to tour_completed with method', () => {
    analytics.trackTourCompleted('finish')
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('tour_completed', {
      method: 'finish',
    })
    vi.mocked(posthog.capture).mockClear()
    analytics.trackTourCompleted('skip')
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('tour_completed', {
      method: 'skip',
    })
  })

  it('trackHouseCountChanged maps to house_count_changed with size/value', () => {
    analytics.trackHouseCountChanged('medium', 3)
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('house_count_changed', {
      size: 'medium',
      value: 3,
    })
  })

  it('trackPokemonAdded maps to pokemon_added with source/name', () => {
    analytics.trackPokemonAdded({ source: 'search', name: 'Pikachu' })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('pokemon_added', {
      source: 'search',
      name: 'Pikachu',
    })
    vi.mocked(posthog.capture).mockClear()
    analytics.trackPokemonAdded({ source: 'house', name: 'Bulbasaur' })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('pokemon_added', {
      source: 'house',
      name: 'Bulbasaur',
    })
  })

  it('trackIslandSaved maps to island_saved with island counts', () => {
    analytics.trackIslandSaved({ pokemon_count: 5, small: 2, medium: 1, large: 0 })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('island_saved', {
      pokemon_count: 5,
      small: 2,
      medium: 1,
      large: 0,
    })
  })

  it('trackIslandLoaded maps to island_loaded with source saved_query', () => {
    analytics.trackIslandLoaded({ source: 'saved_query' })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('island_loaded', {
      source: 'saved_query',
    })
  })

  it('trackItemAdded maps to item_added with house_id/item', () => {
    analytics.trackItemAdded({ house_id: 'S1', item: 'Canoe' })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('item_added', {
      house_id: 'S1',
      item: 'Canoe',
    })
  })

  it('trackItemRemoved maps to item_removed with house_id/item', () => {
    analytics.trackItemRemoved({ house_id: 'S1', item: 'Canoe' })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('item_removed', {
      house_id: 'S1',
      item: 'Canoe',
    })
  })

  it('trackRecommendationsExpanded maps to recommendations_expanded with house_id/visible_count', () => {
    analytics.trackRecommendationsExpanded({ house_id: 'M1', visible_count: 100 })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('recommendations_expanded', {
      house_id: 'M1',
      visible_count: 100,
    })
  })

  it('trackAutoSortToggled maps to auto_sort_toggled with enabled', () => {
    analytics.trackAutoSortToggled(false)
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('auto_sort_toggled', {
      enabled: false,
    })
    vi.mocked(posthog.capture).mockClear()
    analytics.trackAutoSortToggled(true)
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('auto_sort_toggled', {
      enabled: true,
    })
  })

  it('trackPokemonPinned and trackPokemonUnpinned map with house_id/name', () => {
    analytics.trackPokemonPinned({ house_id: 'L1', name: 'Pikachu' })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('pokemon_pinned', {
      house_id: 'L1',
      name: 'Pikachu',
    })
    vi.mocked(posthog.capture).mockClear()
    analytics.trackPokemonUnpinned({ house_id: 'L1', name: 'Pikachu' })
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('pokemon_unpinned', {
      house_id: 'L1',
      name: 'Pikachu',
    })
  })
})
