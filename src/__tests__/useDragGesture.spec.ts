// Unit coverage for the OFF-mode drag gesture (src/composables/useDragGesture.ts)
// and its pure hit-test seam (src/composables/usePokemonDrag.ts).
//
// The composable is driven through its four pointer handlers with plain
// PointerEvent-like objects (jsdom lacks PointerEvent; cast inputs). A small
// real DOM is built for each test — house drop zones (`data-drop-zone="house"`)
// containing resident cards (`data-drag-source` + `data-draggable="true"` +
// `data-drag-name` + `data-from-house` + `.pokemon-drag-handle`) — and
// document.elementsFromPoint is monkeypatched to return the chosen hit-test
// stack per point. setPointerCapture is already wrapped in try/catch in the
// gesture, so jsdom's absence is harmless.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDragGesture } from '@/composables/useDragGesture'
import { useDisplayModel } from '@/composables/useDisplayModel'
import { resolveDropTarget } from '@/composables/usePokemonDrag'
import { useHouseStore } from '@/stores/houses'
import { usePlacementStore } from '@/stores/placements'
import type { PokemonData, SolverResult } from '@/solver'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'

function pokemonCard(name: string, fromHouse: string): HTMLElement {
  const card = document.createElement('div')
  card.className = 'pokemon-card'
  card.setAttribute('data-testid', 'pokemon-card')
  card.setAttribute('data-drag-source', '')
  card.setAttribute('data-drag-name', name)
  card.setAttribute('data-from-house', fromHouse)
  card.setAttribute('data-draggable', 'true')
  const handle = document.createElement('span')
  handle.className = 'pokemon-drag-handle'
  card.appendChild(handle)
  return card
}

function houseZone(houseId: string, cards: HTMLElement[]): HTMLElement {
  const zone = document.createElement('section')
  zone.className = 'house-card drop-zone'
  zone.setAttribute('data-testid', 'house-card')
  zone.setAttribute('data-drop-zone', 'house')
  zone.setAttribute('data-drop-house', houseId)
  const title = document.createElement('h3')
  title.className = 'house-title'
  zone.appendChild(title)
  for (const card of cards) zone.appendChild(card)
  return zone
}

function unhousedZone(cards: HTMLElement[]): HTMLElement {
  const zone = document.createElement('div')
  zone.className = 'unhoused-grid drop-zone'
  zone.setAttribute('data-testid', 'unhoused-pokemon-grid')
  zone.setAttribute('data-drop-zone', 'unhoused')
  for (const card of cards) zone.appendChild(card)
  return zone
}

function toStack(...els: Element[]): Element[] {
  // Mirrors document.elementsFromPoint paint order: front-most (deepest child)
  // first, ancestors and backdrop later.
  return els
}

// Mouse position: constant; the monkeypatched elementsFromPoint ignores
// coordinates and returns the active stack, so only the 6px arm threshold sees
// real numbers (10 → 30 clears it).
const DOWN = { clientX: 10, clientY: 10 }
const UP = { clientX: 10, clientY: 30 }

function pe(partial: Partial<PointerEvent> & { target?: EventTarget | null } = {}): PointerEvent {
  return { pointerId: 1, ...DOWN, ...UP, ...partial } as unknown as PointerEvent
}

interface GestureFactoryOptions {
  houses: Record<string, { capacity: number; pokemon: string[] }>
  // Mimics pinStore.pinnedPokemon: seeded with `${houseId}:${name}` keys — a
  // pinned house seeds every current occupant (src/stores/pins.ts pinHouse),
  // so both individual locks and house-pin locks share this fixture.
  locked?: Set<string>
}

function makeGesture({ houses, locked = new Set() }: GestureFactoryOptions) {
  const placements = new Map<string, string | null>()
  const gesture = useDragGesture({
    isEnabled: () => true,
    getHouse: (houseId) => {
      const fixture = houses[houseId]
      return fixture ? { capacity: fixture.capacity, pokemon: [...fixture.pokemon] } : undefined
    },
    setPlacement: (name, target) => {
      placements.set(name, target)
    },
    isResidentLocked: (houseId, name) => locked.has(`${houseId}:${name}`),
  })
  return { gesture, placements }
}

/** Arms the handle of `sourceCard` and moves to the active stack. */
function startDrag(gesture: ReturnType<typeof useDragGesture>, sourceCard: HTMLElement) {
  const handle = sourceCard.querySelector('.pokemon-drag-handle') as HTMLElement
  gesture.onPointerDown(pe({ target: handle, ...DOWN }))
  gesture.onPointerMove(pe({ ...UP })) // crosses the 6px threshold → armed
}

let activeStack: Element[] = []
// jsdom does not implement document.elementsFromPoint; remember the original
// (possibly undefined) so afterEach can restore whatever the environment had.
const originalFromPoint: ((x: number, y: number) => Element[]) | undefined =
  document.elementsFromPoint
if (!originalFromPoint) {
  document.elementsFromPoint = () => []
}

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  activeStack = []
  document.elementsFromPoint = () => activeStack as Element[]
})

afterEach(() => {
  if (originalFromPoint) document.elementsFromPoint = originalFromPoint
  else delete (document as { elementsFromPoint?: unknown }).elementsFromPoint
})

describe('resolveDropTarget occupant resolution', () => {
  it('reports the resident card under the pointer and null over non-card areas', () => {
    const ivy = pokemonCard('Ivysaur', 'B')
    const zoneB = houseZone('B', [ivy])
    document.body.append(zoneB)

    // Over the resident card: the stacked card resolves to its house + name.
    activeStack = toStack(ivy, zoneB, document.body)
    expect(resolveDropTarget(10, 30)).toEqual({
      type: 'house',
      houseId: 'B',
      occupant: 'Ivysaur',
    })

    // Over the title (house area, no resident card): house target, occupant null.
    activeStack = toStack(zoneB.firstElementChild as Element, zoneB, document.body)
    expect(resolveDropTarget(10, 30)).toEqual({
      type: 'house',
      houseId: 'B',
      occupant: null,
    })
  })

  it('never accepts a drag-source card from outside the matched zone', () => {
    // A card of an outer/overlapping element must not leak into the occupant of
    // house B — only cards contained in the matched zone count.
    const foreign = pokemonCard('Foreign', '')
    const wrapper = document.createElement('div')
    wrapper.appendChild(foreign)
    const zoneB = houseZone('B', [])
    document.body.append(wrapper, zoneB)

    activeStack = toStack(foreign, zoneB, document.body)
    const target = resolveDropTarget(10, 30)
    expect(target).toMatchObject({ type: 'house', houseId: 'B' })
    expect((target as { occupant: string | null }).occupant).toBeNull()
  })

  it('still resolves plain zone targets without a card in the stack', () => {
    const zoneB = houseZone('B', [])
    const unhoused = unhousedZone([])
    document.body.append(zoneB, unhoused)

    activeStack = toStack(zoneB, document.body)
    expect(resolveDropTarget(10, 30)).toEqual({
      type: 'house',
      houseId: 'B',
      occupant: null,
    })

    activeStack = toStack(unhoused, document.body)
    expect(resolveDropTarget(10, 30)).toEqual({ type: 'unhoused', occupant: null })
  })

  it('resolves the unhoused card under the pointer', () => {
    const ivy = pokemonCard('Ivysaur', '')
    const unhoused = unhousedZone([ivy])
    document.body.append(unhoused)

    activeStack = toStack(ivy, unhoused, document.body)
    expect(resolveDropTarget(10, 30)).toEqual({ type: 'unhoused', occupant: 'Ivysaur' })

    // Same zone, outside the card: zone hit, no occupant.
    activeStack = toStack(unhoused, document.body)
    expect(resolveDropTarget(10, 30)).toEqual({ type: 'unhoused', occupant: null })
  })
})

describe('useDragGesture full-house swap', () => {
  it('swaps between two full houses via drop over a resident (AC.1)', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const ivy = pokemonCard('Ivysaur', 'B')
    const zoneA = houseZone('A', [bulba])
    const zoneB = houseZone('B', [ivy])
    document.body.append(zoneA, zoneB)

    const { gesture, placements } = makeGesture({
      houses: {
        A: { capacity: 1, pokemon: ['Bulbasaur'] },
        B: { capacity: 1, pokemon: ['Ivysaur'] },
      },
    })

    startDrag(gesture, bulba)
    activeStack = toStack(ivy, zoneB, document.body)
    gesture.onPointerMove(pe(UP))

    // The hover affordance sees the swappable resident under the pointer.
    expect(gesture.dragOverTarget.value).toMatchObject({ type: 'house', houseId: 'B' })
    expect(gesture.dragOverOccupant.value).toBe('Ivysaur')

    gesture.onPointerUp(pe(UP))

    // Two override entries: the dragged pokemon into B, the displaced resident
    // into the drag's origin house.
    expect(placements.get('Bulbasaur')).toBe('B')
    expect(placements.get('Ivysaur')).toBe('A')
    expect(placements.size).toBe(2)
  })

  it('swap from unhoused sends the resident to the unhoused area (AC.2)', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const zoneA = houseZone('A', [bulba])
    document.body.append(zoneA)

    const { gesture, placements } = makeGesture({
      houses: { A: { capacity: 1, pokemon: ['Bulbasaur'] } },
    })

    // Drag origin = unhoused grid: data-from-house is '' → fromHouseId null.
    const unhoused = pokemonCard('Venusaur', '')
    document.body.append(unhoused)

    startDrag(gesture, unhoused)
    activeStack = toStack(bulba, zoneA, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))

    expect(placements.get('Bulbasaur')).toBeNull() // evicted to the unhoused area
    expect(placements.get('Venusaur')).toBe('A')
    expect(placements.size).toBe(2)
  })

  it('blocked when a full house is dropped on without a resident under the pointer (AC.3)', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const ivy = pokemonCard('Ivysaur', 'B')
    const zoneA = houseZone('A', [bulba])
    const zoneB = houseZone('B', [ivy])
    document.body.append(zoneA, zoneB)

    const { gesture, placements } = makeGesture({
      houses: {
        A: { capacity: 1, pokemon: ['Bulbasaur'] },
        B: { capacity: 1, pokemon: ['Ivysaur'] },
      },
    })

    startDrag(gesture, bulba)
    // Drop over the house title — house zone hit, no resident card.
    activeStack = toStack(zoneB.firstElementChild as Element, zoneB, document.body)
    gesture.onPointerMove(pe(UP))
    expect(gesture.dragOverOccupant.value).toBeNull()
    gesture.onPointerUp(pe(UP))

    expect(placements.size).toBe(0)
  })

  it('blocked when the targeted resident is locked (AC.4)', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const clef = pokemonCard('Clefable', 'C')
    const ivy = pokemonCard('Ivysaur', 'B')
    const zoneA = houseZone('A', [bulba])
    const zoneB = houseZone('B', [ivy])
    const zoneC = houseZone('C', [clef])
    document.body.append(zoneA, zoneB, zoneC)

    // 'A:Bulbasaur' comes from a pinned house (pinHouse seeds every occupant);
    // 'B:Ivysaur' is an individual per-pokemon lock. Both must block.
    const { gesture, placements } = makeGesture({
      houses: {
        A: { capacity: 1, pokemon: ['Bulbasaur'] },
        B: { capacity: 1, pokemon: ['Ivysaur'] },
        C: { capacity: 1, pokemon: ['Clefable'] },
      },
      locked: new Set(['A:Bulbasaur', 'B:Ivysaur']),
    })

    startDrag(gesture, clef)
    activeStack = toStack(ivy, zoneB, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))
    expect(placements.size).toBe(0)

    startDrag(gesture, clef)
    activeStack = toStack(bulba, zoneA, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))
    expect(placements.size).toBe(0)
  })

  it('drop into a house with free capacity over a card-free area appends (AC.5)', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const squirtle = pokemonCard('Squirtle', 'B')
    const zoneA = houseZone('A', [bulba])
    const zoneB = houseZone('B', [squirtle])
    document.body.append(zoneA, zoneB)

    const { gesture, placements } = makeGesture({
      houses: {
        A: { capacity: 1, pokemon: ['Bulbasaur'] },
        B: { capacity: 2, pokemon: ['Squirtle'] },
      },
    })

    // Card-free area of a house with room: plain append (the resident stays).
    startDrag(gesture, bulba)
    activeStack = toStack(zoneB.firstElementChild as Element, zoneB, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))

    expect(placements.size).toBe(1)
    expect(placements.get('Bulbasaur')).toBe('B')
    expect(placements.has('Squirtle')).toBe(false)
  })

  it('swaps with the resident of a house that still has room, leaving the vacant slot vacant', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const squirtle = pokemonCard('Squirtle', 'B')
    const zoneA = houseZone('A', [bulba])
    const zoneB = houseZone('B', [squirtle])
    document.body.append(zoneA, zoneB)

    const { gesture, placements } = makeGesture({
      houses: {
        A: { capacity: 1, pokemon: ['Bulbasaur'] },
        // Two free slots: the drop must exchange the two pokemon rather than
        // only filling one of them.
        B: { capacity: 3, pokemon: ['Squirtle'] },
      },
    })

    startDrag(gesture, bulba)
    activeStack = toStack(squirtle, zoneB, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))

    expect(placements.get('Bulbasaur')).toBe('B')
    expect(placements.get('Squirtle')).toBe('A')
    expect(placements.size).toBe(2)
  })

  it('drop onto an unhoused card swaps it into the origin house', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const ivy = pokemonCard('Ivysaur', '')
    const zoneA = houseZone('A', [bulba])
    const unhoused = unhousedZone([ivy])
    document.body.append(zoneA, unhoused)

    const { gesture, placements } = makeGesture({
      houses: { A: { capacity: 1, pokemon: ['Bulbasaur'] } },
    })

    startDrag(gesture, bulba)
    activeStack = toStack(ivy, unhoused, document.body)
    gesture.onPointerMove(pe(UP))
    expect(gesture.dragOverOccupant.value).toBe('Ivysaur')
    gesture.onPointerUp(pe(UP))

    // The unhoused pokemon takes the house slot; the dragged pokemon goes unhoused.
    expect(placements.get('Bulbasaur')).toBeNull()
    expect(placements.get('Ivysaur')).toBe('A')
    expect(placements.size).toBe(2)
  })

  it('drop onto an unhoused card from the unhoused grid displaces nobody', () => {
    const venusaur = pokemonCard('Venusaur', '')
    const ivy = pokemonCard('Ivysaur', '')
    const unhoused = unhousedZone([venusaur, ivy])
    document.body.append(unhoused)

    const { gesture, placements } = makeGesture({ houses: {} })

    startDrag(gesture, venusaur)
    activeStack = toStack(ivy, unhoused, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))

    // Nothing to swap with: the unhoused card keeps its place and no override is
    // recorded at all for the already-unhoused dragged pokemon.
    expect(placements.size).toBe(0)
  })

  it('rejects an occupant that is not a resident of the full target house', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const stale = pokemonCard('Clefable', 'B')
    const zoneA = houseZone('A', [bulba])
    // B's zone holds a card that is not on B's roster (a stale/foreign card) and
    // B is full: the swap must be rejected rather than displaced, and there is no
    // room to append either.
    const zoneB = houseZone('B', [stale])
    document.body.append(zoneA, zoneB)

    const { gesture, placements } = makeGesture({
      houses: {
        A: { capacity: 1, pokemon: ['Bulbasaur'] },
        B: { capacity: 1, pokemon: ['Ivysaur'] },
      },
    })

    startDrag(gesture, bulba)
    activeStack = toStack(stale, zoneB, document.body)
    gesture.onPointerUp(pe(UP))

    expect(placements.size).toBe(0)
  })

  it('a locked resident blocks the swap but still accepts an append when the house has room', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const squirtle = pokemonCard('Squirtle', 'B')
    const zoneA = houseZone('A', [bulba])
    const zoneB = houseZone('B', [squirtle])
    document.body.append(zoneA, zoneB)

    const { gesture, placements } = makeGesture({
      houses: {
        A: { capacity: 1, pokemon: ['Bulbasaur'] },
        B: { capacity: 2, pokemon: ['Squirtle'] },
      },
      locked: new Set(['B:Squirtle']),
    })

    startDrag(gesture, bulba)
    activeStack = toStack(squirtle, zoneB, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))

    // The locked resident is never displaced; the free slot still takes the drop.
    expect(placements.size).toBe(1)
    expect(placements.get('Bulbasaur')).toBe('B')
    expect(placements.has('Squirtle')).toBe(false)
  })

  it('drop onto a resident of the dragged pokemon own house writes no placement (AC.7)', () => {
    const bulba = pokemonCard('Bulbasaur', 'A')
    const ivy = pokemonCard('Ivysaur', 'A')
    const zoneA = houseZone('A', [bulba, ivy])
    document.body.append(zoneA)

    // Full own house (2/2), housemate resident under the pointer.
    const fullHouse = makeGesture({
      houses: { A: { capacity: 2, pokemon: ['Bulbasaur', 'Ivysaur'] } },
    })
    startDrag(fullHouse.gesture, ivy)
    activeStack = toStack(bulba, zoneA, document.body)
    fullHouse.gesture.onPointerMove(pe(UP))
    fullHouse.gesture.onPointerUp(pe(UP))
    expect(fullHouse.placements.size).toBe(0)

    // Same guard with room to spare: dropping back onto the origin house is a
    // no-op even when it could append.
    const underfull = makeGesture({
      houses: { A: { capacity: 3, pokemon: ['Bulbasaur', 'Ivysaur'] } },
    })
    startDrag(underfull.gesture, ivy)
    activeStack = toStack(bulba, zoneA, document.body)
    underfull.gesture.onPointerMove(pe(UP))
    underfull.gesture.onPointerUp(pe(UP))
    expect(underfull.placements.size).toBe(0)
  })

  it('hover occupant tracks card changes within one house while the house highlight stays stable', () => {
    const ivy = pokemonCard('Ivysaur', 'B')
    const ivy2 = pokemonCard('Wigglytuff', 'B')
    const zoneB = houseZone('B', [ivy, ivy2])
    document.body.append(zoneB)

    const { gesture, placements } = makeGesture({
      houses: { B: { capacity: 2, pokemon: ['Ivysaur', 'Wigglytuff'] } },
    })
    const bulba = pokemonCard('Bulbasaur', 'A')
    document.body.append(bulba)

    startDrag(gesture, bulba)

    activeStack = toStack(ivy, zoneB)
    gesture.onPointerMove(pe(UP))
    expect(gesture.dragOverTarget.value).toMatchObject({ type: 'house', houseId: 'B' })
    expect(gesture.dragOverOccupant.value).toBe('Ivysaur')

    // Card-free area of the same house: house highlight unchanged (sameTarget
    // gates on house identity only), occupant refreshes to null.
    activeStack = toStack(zoneB.firstElementChild as Element, zoneB)
    gesture.onPointerMove(pe(UP))
    expect(gesture.dragOverTarget.value).toMatchObject({ type: 'house', houseId: 'B' })
    expect(gesture.dragOverOccupant.value).toBeNull()

    // Another resident card: occupant follows the pointer again.
    activeStack = toStack(ivy2, zoneB)
    gesture.onPointerMove(pe(UP))
    expect(gesture.dragOverOccupant.value).toBe('Wigglytuff')

    // Leaving all zones clears both affordances.
    activeStack = toStack(document.body)
    gesture.onPointerMove(pe(UP))
    expect(gesture.dragOverTarget.value).toBeNull()
    expect(gesture.dragOverOccupant.value).toBeNull()

    expect(placements.size).toBe(0)

    // The drag origin is exposed so the caller can suppress the swap affordance
    // on the drag's own house; it clears with the drag.
    expect(gesture.dragFromHouseId.value).toBe('A')
    gesture.onPointerCancel(pe(UP))
    expect(gesture.dragFromHouseId.value).toBeNull()
  })

  it('reports a null drag origin when the drag starts in the unhoused grid', () => {
    const unhoused = pokemonCard('Venusaur', '')
    document.body.append(unhoused)

    const { gesture } = makeGesture({ houses: {} })
    startDrag(gesture, unhoused)
    expect(gesture.dragFromHouseId.value).toBeNull()
  })
})

describe('useDragGesture swap through the display model', () => {
  // The risky invariant lives in useDisplayModel (each override entry removes
  // its name from every house, then appends to its target): a swap must leave
  // exactly one resident per house — never a double count, never an empty one.
  it('leaves exactly one resident per house after a full-house swap', async () => {
    const houseStore = useHouseStore()
    const placementStore = usePlacementStore()
    houseStore.reconcileHouses({ small: 2, medium: 0, large: 0 }, new Set())

    const swapData: PokemonData = {
      Alpha: { image: 'alpha.png', favorites: [], habitat: 'Bright' },
      Beta: { image: 'beta.png', favorites: [], habitat: 'Bright' },
    }
    const display = useDisplayModel({
      result: ref<SolverResult | null>({
        houses: [
          { houseId: 'S1', size: 'small', capacity: 1, pokemon: ['Alpha'] },
          { houseId: 'S2', size: 'small', capacity: 1, pokemon: ['Beta'] },
        ],
        unhoused: [],
      }),
      selectedPokemon: ref(['Alpha', 'Beta']),
      pokemonData: ref(swapData),
      autoSort: ref(false),
    })

    const gesture = useDragGesture({
      isEnabled: () => true,
      getHouse: (houseId) => display.displayedHouses.value.find((h) => h.houseId === houseId),
      setPlacement: (name, target) => placementStore.set(name, target),
    })

    const alpha = pokemonCard('Alpha', 'S1')
    const beta = pokemonCard('Beta', 'S2')
    const zoneS1 = houseZone('S1', [alpha])
    const zoneS2 = houseZone('S2', [beta])
    document.body.append(zoneS1, zoneS2)

    // Both houses are full 1/1 with the last solve's occupants.
    expect(display.displayedHouses.value.map((h) => h.pokemon)).toEqual([['Alpha'], ['Beta']])

    startDrag(gesture, alpha)
    activeStack = toStack(beta, zoneS2, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))

    await nextTick()
    const byId = (id: string) => display.displayedHouses.value.find((h) => h.houseId === id)
    expect(byId('S1')?.pokemon).toEqual(['Beta'])
    expect(byId('S2')?.pokemon).toEqual(['Alpha'])
    // Exactly one resident each — no house ends over capacity or empty.
    expect(display.displayedHouses.value.map((h) => h.pokemon.length)).toEqual([1, 1])
    expect(display.displayedUnhoused.value).toEqual([])
  })

  // Dropping onto a resident of a house that still has room must exchange the
  // two pokemon instead of only filling the free slot.
  it('leaves the free slot empty when a swap lands in a house with room', async () => {
    const houseStore = useHouseStore()
    const placementStore = usePlacementStore()
    houseStore.reconcileHouses({ small: 1, medium: 1, large: 0 }, new Set())

    const swapData: PokemonData = {
      Alpha: { image: 'alpha.png', favorites: [], habitat: 'Bright' },
      Beta: { image: 'beta.png', favorites: [], habitat: 'Bright' },
    }
    const display = useDisplayModel({
      result: ref<SolverResult | null>({
        houses: [
          { houseId: 'S1', size: 'small', capacity: 1, pokemon: ['Alpha'] },
          { houseId: 'M1', size: 'medium', capacity: 2, pokemon: ['Beta'] },
        ],
        unhoused: [],
      }),
      selectedPokemon: ref(['Alpha', 'Beta']),
      pokemonData: ref(swapData),
      autoSort: ref(false),
    })

    const gesture = useDragGesture({
      isEnabled: () => true,
      getHouse: (houseId) => display.displayedHouses.value.find((h) => h.houseId === houseId),
      setPlacement: (name, target) => placementStore.set(name, target),
    })

    const alpha = pokemonCard('Alpha', 'S1')
    const beta = pokemonCard('Beta', 'M1')
    const zoneS1 = houseZone('S1', [alpha])
    const zoneM1 = houseZone('M1', [beta])
    document.body.append(zoneS1, zoneM1)

    // M1 is 1/2 — one resident, one vacant slot.
    expect(display.displayedHouses.value.map((h) => h.pokemon.length)).toEqual([1, 1])

    startDrag(gesture, alpha)
    activeStack = toStack(beta, zoneM1, document.body)
    gesture.onPointerMove(pe(UP))
    gesture.onPointerUp(pe(UP))

    await nextTick()
    const byId = (id: string) => display.displayedHouses.value.find((h) => h.houseId === id)
    expect(byId('S1')?.pokemon).toEqual(['Beta'])
    expect(byId('M1')?.pokemon).toEqual(['Alpha'])
    // M1 still holds exactly one pokemon: the swap did not consume the vacant slot.
    expect(display.displayedHouses.value.map((h) => h.pokemon.length)).toEqual([1, 1])
  })
})
