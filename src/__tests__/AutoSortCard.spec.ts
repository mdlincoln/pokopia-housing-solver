import AutoSortCard from '@/components/AutoSortCard.vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

function mountCard(modelValue = true) {
  return mount(AutoSortCard, {
    props: { modelValue },
  })
}

describe('AutoSortCard', () => {
  it('renders as a config card with an h2 title and the Auto/Manual button group', () => {
    const wrapper = mountCard()

    expect(wrapper.find('[data-testid="autosort-card"]').exists()).toBe(true)
    const h2 = wrapper.find('h2.section-heading')
    expect(h2.exists()).toBe(true)
    expect(h2.text()).toBe('Automatically sort Pokemon')

    const group = wrapper.find('[aria-label="Automatically sort Pokemon"]')
    expect(group.exists()).toBe(true)
    expect(wrapper.find('[data-testid="auto-sort-group"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="auto-sort-auto"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="auto-sort-manual"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="auto-sort-auto"]').text()).toBe('Auto sort')
    expect(wrapper.find('[data-testid="auto-sort-manual"]').text()).toBe('Manual sort')
  })

  it('pressed state follows modelValue true: Auto sort pressed, Manual sort not', () => {
    const wrapper = mountCard(true)

    expect(wrapper.find('[data-testid="auto-sort-auto"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="auto-sort-auto"]').classes()).toContain('active')
    // Exactly one button carries the visible pressed class.
    expect(wrapper.findAll('.btn.active')).toHaveLength(1)
    expect(
      wrapper.find('[data-testid="auto-sort-manual"]').attributes('aria-pressed') !== 'true',
    ).toBe(true)
    expect(wrapper.find('[data-testid="auto-sort-manual"]').classes()).not.toContain('active')
  })

  it('pressed state follows modelValue false: Manual sort pressed, Auto sort not', () => {
    const wrapper = mountCard(false)

    expect(wrapper.find('[data-testid="auto-sort-manual"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="auto-sort-manual"]').classes()).toContain('active')
    expect(wrapper.findAll('.btn.active')).toHaveLength(1)
    expect(
      wrapper.find('[data-testid="auto-sort-auto"]').attributes('aria-pressed') !== 'true',
    ).toBe(true)
    expect(wrapper.find('[data-testid="auto-sort-auto"]').classes()).not.toContain('active')
  })

  it('is on by default (modelValue true) and shows the on helper text', () => {
    const wrapper = mountCard(true)

    expect(wrapper.text()).toContain('Assignments update as you add Pokémon')
    expect(wrapper.find('[data-testid="autosort-card"]').classes()).not.toContain(
      'autosort-card--off',
    )
  })

  it('clicking Manual sort emits update:modelValue false', async () => {
    const wrapper = mountCard(true)

    await wrapper.find('[data-testid="auto-sort-manual"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('clicking Auto sort emits update:modelValue true', async () => {
    const wrapper = mountCard(false)

    await wrapper.find('[data-testid="auto-sort-auto"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('shows the off helper text and the off accent class when modelValue is false', () => {
    const wrapper = mountCard(false)

    expect(wrapper.text()).toContain('New Pokémon wait unassigned while this is off')
    expect(wrapper.find('[data-testid="autosort-card"]').classes()).toContain('autosort-card--off')
  })
})
