// Single source of truth for PostHog feature-usage instrumentation.
//
// All feature events flow through this module — components and stores must
// never call `posthog.capture` directly. Event names are snake_case and
// property values are app data only (no PII). The module deliberately imports
// no project code, so it is dependency-free and safe to import from any test.
//
// Invariant: the restore paths (restoreState, restoreFromHash) and loadSample
// mutate refs/stores directly rather than routing through the tracked
// user-action handlers, so they never emit feature events. Tracking calls live
// only in explicit user-action choke points.

import posthog from 'posthog-js'

export const ANALYTICS_EVENTS = {
  appLanded: 'app_landed',
  sharedLinkOpened: 'shared_link_opened',
  tourStarted: 'tour_started',
  tourCompleted: 'tour_completed',
  houseCountChanged: 'house_count_changed',
  pokemonAdded: 'pokemon_added',
  islandSaved: 'island_saved',
  islandLoaded: 'island_loaded',
  itemAdded: 'item_added',
  itemRemoved: 'item_removed',
  recommendationsExpanded: 'recommendations_expanded',
  autoSortToggled: 'auto_sort_toggled',
  pokemonPinned: 'pokemon_pinned',
  pokemonUnpinned: 'pokemon_unpinned',
} as const

export function track(event: string, properties?: Record<string, unknown>): void {
  posthog.capture(event, properties)
}

export function trackAppLanded(arrivalSource: 'direct' | 'shared_link'): void {
  track(ANALYTICS_EVENTS.appLanded, { arrival_source: arrivalSource })
}

export function trackSharedLinkOpened(counts: {
  pokemon_count: number
  small: number
  medium: number
  large: number
}): void {
  track(ANALYTICS_EVENTS.sharedLinkOpened, counts)
}

export function trackTourStarted(): void {
  track(ANALYTICS_EVENTS.tourStarted)
}

export function trackTourCompleted(method: 'finish' | 'skip'): void {
  track(ANALYTICS_EVENTS.tourCompleted, { method })
}

export function trackHouseCountChanged(size: 'small' | 'medium' | 'large', value: number): void {
  track(ANALYTICS_EVENTS.houseCountChanged, { size, value })
}

export function trackPokemonAdded(info: { source: 'search' | 'house'; name: string }): void {
  track(ANALYTICS_EVENTS.pokemonAdded, info)
}

export function trackIslandSaved(counts: {
  pokemon_count: number
  small: number
  medium: number
  large: number
}): void {
  track(ANALYTICS_EVENTS.islandSaved, counts)
}

export function trackIslandLoaded(info: { source: 'saved_query' }): void {
  track(ANALYTICS_EVENTS.islandLoaded, info)
}

export function trackItemAdded(info: { house_id: string; item: string }): void {
  track(ANALYTICS_EVENTS.itemAdded, info)
}

export function trackItemRemoved(info: { house_id: string; item: string }): void {
  track(ANALYTICS_EVENTS.itemRemoved, info)
}

export function trackRecommendationsExpanded(info: {
  house_id: string
  visible_count: number
}): void {
  track(ANALYTICS_EVENTS.recommendationsExpanded, info)
}

export function trackAutoSortToggled(enabled: boolean): void {
  track(ANALYTICS_EVENTS.autoSortToggled, { enabled })
}

export function trackPokemonPinned(info: { house_id: string; name: string }): void {
  track(ANALYTICS_EVENTS.pokemonPinned, info)
}

export function trackPokemonUnpinned(info: { house_id: string; name: string }): void {
  track(ANALYTICS_EVENTS.pokemonUnpinned, info)
}
