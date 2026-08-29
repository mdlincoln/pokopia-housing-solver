// Unit tests for the habitat-detail modal. @/queries is mocked (following the
// existing spec mock patterns) so the render matrix is independent of the
// baked catalog; the real data path is covered by e2e/habitat.spec.ts.
//
// BModal teleports its content to document.body; stubbing <Teleport> keeps it
// inline inside the test wrapper so assertions can query wrapper.element.

import HabitatModal from '@/components/HabitatModal.vue'
import type { HabitatDetails, SpawnHabitat } from '@/queries'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getHabitatDetailsMock, getPokemonSpritesMock } = vi.hoisted(() => ({
  getHabitatDetailsMock: vi.fn<() => Promise<import('@/queries').HabitatDetails | null>>(),
  getPokemonSpritesMock: vi.fn<() => Promise<Record<string, string | null>>>(),
}))

vi.mock('@/queries', () => ({
  getHabitatDetails: getHabitatDetailsMock,
  getPokemonSprites: getPokemonSpritesMock,
}))

const tallGrass: SpawnHabitat = { id: 1, name: 'Tall Grass', image: 'images/habitats/1.png' }

function makeDetails(): HabitatDetails {
  return {
    id: 1,
    name: 'Tall Grass',
    image: 'images/habitats/1.png',
    description: 'Four tufts of tall grass bunched together in a plot.',
    category: 'main',
    pokemon: [
      {
        name: 'Bulbasaur',
        rarity: 'Common',
        times: ['Morning', 'Day', 'Evening', 'Night'],
        weathers: ['Sun', 'Cloud', 'Rain'],
        locations: ['Bleak Beach', 'Cloud Island'],
      },
      {
        name: 'Ivysaur',
        rarity: null,
        times: ['Day'],
        weathers: ['Sun'],
        locations: ['Palette Town'],
      },
      {
        // Roster names absent from the pokemon catalog render name-only.
        name: 'Porygon-Z',
        rarity: 'Rare',
        times: ['Night'],
        weathers: ['Rain'],
        locations: ['Rocky Ridges'],
      },
    ],
  }
}

interface ModalWrapper {
  modal: Element | null
  text: string
}

async function mountModal(props: {
  habitat: SpawnHabitat | null
}): Promise<ReturnType<typeof mount> & { rendered(): ModalWrapper }> {
  const wrapper = mount(HabitatModal, {
    props,
    global: {
      stubs: { Teleport: true },
    },
  })
  await flushPromises()
  const rendered = () => ({
    modal: wrapper.element.querySelector('[data-testid="habitat-modal"]'),
    text: wrapper.element.textContent ?? '',
  })
  return Object.assign(wrapper, { rendered })
}

describe('HabitatModal', () => {
  beforeEach(() => {
    getHabitatDetailsMock.mockReset()
    getPokemonSpritesMock.mockReset()
    getHabitatDetailsMock.mockResolvedValue(makeDetails())
    getPokemonSpritesMock.mockResolvedValue({
      Bulbasaur: 'images/1.png',
      Ivysaur: 'images/2.png',
      'Porygon-Z': null,
    })
  })

  it('renders the habitat name, image path, and description', async () => {
    const { rendered } = await mountModal({ habitat: tallGrass })

    const { modal } = rendered()
    expect(modal).not.toBeNull()
    expect(modal!.querySelector('.modal-title')!.textContent).toBe('Tall Grass')

    const image = modal!.querySelector('[data-testid="habitat-modal-image"]') as HTMLElement
    expect(image).not.toBeNull()
    expect(image.getAttribute('src')).toBe('/images/habitats/1.png')

    expect(rendered().text).toContain('Four tufts of tall grass bunched together in a plot.')
  })

  it('renders one roster row per pokemon with rarity badge, condition chips, and locations', async () => {
    const { rendered } = await mountModal({ habitat: tallGrass })

    const modal = rendered().modal!
    const spawns = modal.querySelectorAll('[data-testid="habitat-modal-spawn"]')
    expect(spawns).toHaveLength(3)

    const bulbasaur = spawns[0]!
    expect(bulbasaur.textContent).toContain('Bulbasaur')
    const rarity = bulbasaur.querySelector('[data-testid="habitat-modal-rarity"]')!
    expect(rarity.textContent).toBe('Common')
    expect(rarity.classList.toString()).toContain('text-bg-success')

    // One chip per time value, each with a glyph svg AND a visible label.
    const timeChips = bulbasaur.querySelectorAll('[data-testid="habitat-modal-time"]')
    expect(timeChips).toHaveLength(4)
    for (const chip of timeChips) {
      expect(chip.querySelector('.icon-glyph svg')).not.toBeNull()
    }
    expect(timeChips[0]!.textContent!.trim()).toContain('Morning')

    const weatherChips = bulbasaur.querySelectorAll('[data-testid="habitat-modal-weather"]')
    expect(weatherChips).toHaveLength(3)
    for (const chip of weatherChips) {
      expect(chip.querySelector('.icon-glyph svg')).not.toBeNull()
    }

    const locations = bulbasaur.querySelector('[data-testid="habitat-modal-locations"]')!
    expect(locations.textContent).toContain('Bleak Beach')
    expect(locations.textContent).toContain('Cloud Island')
  })

  it('null rarity renders a muted Unknown badge', async () => {
    const { rendered } = await mountModal({ habitat: tallGrass })

    const modal = rendered().modal!
    const spawns = modal.querySelectorAll('[data-testid="habitat-modal-spawn"]')
    const ivysaur = spawns[1]!
    const rarity = ivysaur.querySelector('[data-testid="habitat-modal-rarity"]')!
    expect(rarity.textContent).toBe('Unknown')
    expect(rarity.classList.toString()).toContain('text-bg-secondary')
  })

  it('roster pokemon without a resolved sprite render name-only', async () => {
    const { rendered } = await mountModal({ habitat: tallGrass })

    const modal = rendered().modal!
    const spawns = modal.querySelectorAll('[data-testid="habitat-modal-spawn"]')
    const porygonZ = spawns[2]!

    // Sprite img present for known pokemon, absent for Porygon-Z.
    expect(spawns[0]!.querySelector('.habitat-modal-sprite')).not.toBeNull()
    expect(porygonZ.querySelector('.habitat-modal-sprite')).toBeNull()
    expect(porygonZ.textContent).toContain('Porygon-Z')
  })

  it('renders nothing without a BModal when habitat is null', async () => {
    const wrapper = await mountModal({ habitat: null })
    expect(getHabitatDetailsMock).not.toHaveBeenCalled()
    const modalEl = wrapper.element.querySelector('[data-testid="habitat-modal"]') as HTMLElement
    expect(modalEl).not.toBeNull()
    // BModal keeps a hidden (display: none) shell when closed — no title, no
    // roster rows, no detail content (only the pre-rendered OK button).
    expect(modalEl.getAttribute('style')).toContain('display: none')
    expect(modalEl.textContent).not.toContain('Tall Grass')
    expect(modalEl.querySelector('[data-testid="habitat-modal-spawn"]')).toBeNull()
  })

  it('a failed detail lookup renders an error alert', async () => {
    getHabitatDetailsMock.mockResolvedValue(null)
    const { rendered } = await mountModal({ habitat: tallGrass })

    expect(rendered().text).toContain('Could not load habitat details.')
  })

  it('rejecting the detail promise also renders the error alert', async () => {
    getHabitatDetailsMock.mockRejectedValue(new Error('boom'))
    const { rendered } = await mountModal({ habitat: tallGrass })

    expect(rendered().text).toContain('Could not load habitat details.')
  })

  it('modal title is an h2 (modal h2 document-outline convention)', async () => {
    const { rendered } = await mountModal({ habitat: tallGrass })

    const modal = rendered().modal!
    expect(modal.querySelector('h2.modal-title')).not.toBeNull()
    expect(modal.querySelector('h3')!.textContent).toBe('Pokémon found here')
  })
})
