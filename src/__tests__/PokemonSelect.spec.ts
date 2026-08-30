import PokemonSelect from '@/components/PokemonSelect.vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const NAMES = ['Abra', 'Absol', 'Bulbasaur']

function mountSelect() {
  return mount(PokemonSelect, {
    props: { pokemonNames: NAMES, modelValue: [] },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PokemonSelect combobox semantics (AC.6)', () => {
  it('exposes an accessible name and combobox role', () => {
    const wrapper = mountSelect()
    const input = wrapper.find('input.pokemon-search')
    expect(input.attributes('aria-label')).toBe('Search Pokémon to add')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-haspopup')).toBe('listbox')
    expect(input.attributes('aria-controls')).toBeTruthy()
  })

  it('toggles aria-expanded with the suggestion list', async () => {
    const wrapper = mountSelect()
    const input = wrapper.find('input.pokemon-search')

    expect(input.attributes('aria-expanded')).toBe('false')

    await input.trigger('focus')
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)

    vi.useFakeTimers()
    await input.trigger('blur')
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('collapses when no options match', async () => {
    const wrapper = mountSelect()
    const input = wrapper.find('input.pokemon-search')

    await input.trigger('focus')
    expect(input.attributes('aria-expanded')).toBe('true')

    await input.setValue('zzz')
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('renders a listbox whose option ids match aria-activedescendant', async () => {
    const wrapper = mountSelect()
    const input = wrapper.find('input.pokemon-search')

    await input.trigger('focus')
    const listbox = wrapper.find('[role="listbox"]')
    expect(listbox.exists()).toBe(true)
    expect(listbox.attributes('id')).toBe(input.attributes('aria-controls'))

    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(3)
    for (const option of options) {
      expect(option.attributes('id')).toBeTruthy()
    }

    expect(input.attributes('aria-activedescendant')).toBe(options[0]!.attributes('id'))

    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[1]!.attributes('id'),
    )

    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(input.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[0]!.attributes('id'),
    )
  })

  it('announces match counts in a polite live region mounted unconditionally', async () => {
    const wrapper = mountSelect()
    const status = wrapper.find('[data-testid="pokemon-search-status"]')
    expect(status.exists()).toBe(true)
    expect(status.attributes('aria-live')).toBe('polite')
    expect(status.text()).toBe('')

    const input = wrapper.find('input.pokemon-search')
    await input.trigger('focus')
    expect(status.text()).toBe('3 Pokémon match')

    await input.setValue('ab')
    expect(status.text()).toBe('2 Pokémon match')

    await input.setValue('zzz')
    expect(status.text()).toBe('No Pokémon match')
  })

  it('hides excludeNames entries from suggestion filtering', async () => {
    const wrapper = mount(PokemonSelect, {
      props: { pokemonNames: NAMES, modelValue: [], excludeNames: new Set(['Abra']) },
    })
    const input = wrapper.find('input.pokemon-search')

    await input.trigger('focus')
    expect(wrapper.findAll('[role="option"]').map((o) => o.text())).toEqual(['Absol', 'Bulbasaur'])

    // Excluded names stay hidden even when the query would match them, and
    // unlike modelValue entries they never render as chips.
    await input.setValue('ab')
    expect(wrapper.findAll('[role="option"]').map((o) => o.text())).toEqual(['Absol'])
    expect(wrapper.find('[data-testid="pokemon-search-status"]').text()).toBe('1 Pokémon matches')
  })

  it('still selects via keyboard Enter with the combobox wiring in place', async () => {
    const wrapper = mountSelect()
    const input = wrapper.find('input.pokemon-search')

    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    // full list ['Abra', 'Absol', 'Bulbasaur']; two ArrowDowns → index 2
    expect(wrapper.emitted('update:modelValue')).toEqual([[['Bulbasaur']]])
  })
})
