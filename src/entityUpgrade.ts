// Pure restore-time entity upgrade: resolves every entity *name* in a
// SharedState against the live catalog (with baked tombstones as fallback) so
// legacy URL hashes and saved islands survive entity renames. Names that
// resolve to neither are dropped from the state and reported, so the restore
// callers can surface a native alert. No Vue or store imports — this module is
// deterministic and unit-testable on its own.

import type { SharedState } from '@/composables/useSavedQueries'
import type { EntityNameResolvers } from '@/queries'

export type EntityType = 'pokemon' | 'item'

export interface UnmappedEntity {
  type: EntityType
  name: string
}

export interface RestoreResult {
  state: SharedState
  unmapped: UnmappedEntity[]
  upgraded: boolean
}

export function upgradeSharedState(
  state: SharedState,
  resolvers: EntityNameResolvers,
): RestoreResult {
  const unmapped: UnmappedEntity[] = []
  let upgraded = false

  // Returns the resolved name, or null when the entity should be dropped.
  const resolve = (type: EntityType, name: string): string | null => {
    const resolved =
      type === 'pokemon' ? resolvers.resolvePokemon(name) : resolvers.resolveItem(name)
    if (resolved === null) {
      unmapped.push({ type, name })
      upgraded = true
      return null
    }
    if (resolved !== name) {
      upgraded = true
    }
    return resolved
  }

  // Selected pokemon: resolve each name, de-duplicating while preserving
  // first occurrence — an old name and its (recycled) canonical twin
  // co-existing in one hash must collapse to one entry.
  const selectedPokemon: string[] = []
  const seenPokemon = new Set<string>()
  for (const name of state.pokemon) {
    const resolved = resolve('pokemon', name)
    if (resolved === null || seenPokemon.has(resolved)) continue
    seenPokemon.add(resolved)
    selectedPokemon.push(resolved)
  }

  // Cart items: resolve item names; unmapped entries drop; de-duped by
  // house + resolved item name. Legacy houseIndex/quantity tolerance stays
  // with cartStore.restoreItems — those fields pass through untouched.
  let cart: SharedState['cart']
  if (state.cart !== undefined) {
    cart = []
    const seenCart = new Set<string>()
    for (const entry of state.cart) {
      const resolved = resolve('item', entry.name)
      if (resolved === null) continue
      const key = `${entry.houseId ?? ''}:${resolved}`
      if (seenCart.has(key)) continue
      seenCart.add(key)
      cart.push(resolved === entry.name ? entry : { ...entry, name: resolved })
    }
  }

  // "houseId:name" composite keys (pinnedPokemon pins, checkedCartItems and
  // placedItems progress keys). House ids never contain colons, so split on
  // the first colon; a colon-less key is treated as a bare name.
  const resolveCompositeKey = (
    type: EntityType,
    key: string,
  ): { mapped: boolean; key: string | null } => {
    const idx = key.indexOf(':')
    const name = idx === -1 ? key : key.slice(idx + 1)
    const resolved = resolve(type, name)
    if (resolved === null) return { mapped: false, key: null }
    if (idx === -1) return { mapped: true, key: resolved === name ? key : resolved }
    return { mapped: true, key: `${key.slice(0, idx)}:${resolved}` }
  }

  let pinnedPokemon: string[] | undefined
  if (state.pinnedPokemon !== undefined) {
    pinnedPokemon = []
    for (const key of state.pinnedPokemon) {
      const { key: resolvedKey } = resolveCompositeKey('pokemon', key)
      if (resolvedKey !== null) pinnedPokemon.push(resolvedKey)
    }
  }

  let checkedCartItems: string[] | undefined
  if (state.checkedCartItems !== undefined) {
    checkedCartItems = []
    for (const key of state.checkedCartItems) {
      const { key: resolvedKey } = resolveCompositeKey('item', key)
      if (resolvedKey !== null) checkedCartItems.push(resolvedKey)
    }
  }

  let placedItems: string[] | undefined
  if (state.placedItems !== undefined) {
    placedItems = []
    for (const key of state.placedItems) {
      const { key: resolvedKey } = resolveCompositeKey('item', key)
      if (resolvedKey !== null) placedItems.push(resolvedKey)
    }
  }

  // Fresh state object — never mutate the input. Fields restoreState ignores
  // today (legacy checkedHouses/checkedPokemon) are left untouched. Optional
  // fields keep their undefined-ness so a fully-clean state round-trips
  // byte-identically.
  const result: SharedState = { ...state, pokemon: selectedPokemon }
  if (cart !== undefined) result.cart = cart
  if (pinnedPokemon !== undefined) result.pinnedPokemon = pinnedPokemon
  if (checkedCartItems !== undefined) result.checkedCartItems = checkedCartItems
  if (placedItems !== undefined) result.placedItems = placedItems

  return { state: result, unmapped, upgraded }
}

/**
 * Alert body for entities that could not be resolved, grouped by type. The
 * requirement is type labels + names + a re-search CTA.
 */
export function formatUnmappedAlert(unmapped: UnmappedEntity[]): string {
  const pokemon = unmapped.filter((e) => e.type === 'pokemon').map((e) => e.name)
  const items = unmapped.filter((e) => e.type === 'item').map((e) => e.name)
  const lines: string[] = []
  if (pokemon.length > 0) lines.push(`Pokémon: ${pokemon.join(', ')}`)
  if (items.length > 0) lines.push(`Items: ${items.join(', ')}`)
  return (
    'Some Pokémon or items in this island could no longer be found and were removed:\n\n' +
    lines.join('\n') +
    '\n\nThe rest of your island was restored. Try searching for them by name to add them back.'
  )
}
