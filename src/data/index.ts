// Runtime data layer: loads the baked, denormalized payloads produced by
// `npm run build:data` (scripts/build_data.mjs). The sqlite DB remains the
// source of truth for harvesting, but no SQL or WASM runs in the browser —
// everything below is a bundled import or a single fetch of a static asset.
//
//   pokemon.json  + items.json  — bundled by Vite (small, always needed)
//   adjacency.json              — public/data/, fetched once, decoded into an
//                                 Int16Array (kept out of the JS bundle)

import { assetPath } from '@/assetPath'
import type { AdjacencyData } from '@/solver'

import pokemonJson from './pokemon.json'
import itemsJson from './items.json'

export interface PokemonCatalog {
  names: string[]
  dataByName: Record<string, { image: string; favorites: string[]; habitat?: string }>
}

// JSON-shaped item graph (plain objects/arrays instead of Maps). Key insertion
// order in itemsByFavorite / recipeByItem mirrors the generator's SQL ORDER BY
// and is load-bearing for recommendation ordering — do not re-sort.
export interface ItemGraphData {
  itemDetailsByName: Record<
    string,
    {
      name: string
      category: string | null
      flavorText: string | null
      picturePath: string | null
      tag: string | null
      isCraftable: boolean
    }
  >
  itemsByFavorite: Record<string, string[]>
  favoritesByItem: Record<string, string[]>
  recipeByItem: Record<
    string,
    Array<{ ingredientName: string; ingredientPicture: string | null; count: number }>
  >
}

const catalog = pokemonJson as PokemonCatalog
const itemGraph = itemsJson as ItemGraphData

export function loadPokemonCatalog(): PokemonCatalog {
  return catalog
}

export function loadItemGraphData(): ItemGraphData {
  return itemGraph
}

interface AdjacencyPayload {
  names: string[]
  size: number
  data: string // base64 of the raw Int16Array buffer (little-endian)
}

let _adjacencyPromise: Promise<AdjacencyData> | null = null

// Fetches and decodes the adjacency matrix exactly once. The returned
// structure is a flat Int16Array + name index — cheap to structured-clone to
// the solver worker (unlike the old nested-Map AdjacencyMap).
export function loadAdjacencyData(): Promise<AdjacencyData> {
  _adjacencyPromise ??= (async (): Promise<AdjacencyData> => {
    const payload: AdjacencyPayload = await fetch(assetPath('data/adjacency.json')).then((r) => {
      if (!r.ok) throw new Error(`Failed to load adjacency data: HTTP ${r.status}`)
      return r.json()
    })
    const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0))
    const matrix = new Int16Array(bytes.buffer, bytes.byteOffset, payload.size * payload.size)
    const indexByName = new Map<string, number>()
    for (let i = 0; i < payload.names.length; i++) {
      indexByName.set(payload.names[i]!, i)
    }
    return { names: payload.names, indexByName, size: payload.size, matrix }
  })()
  return _adjacencyPromise
}

