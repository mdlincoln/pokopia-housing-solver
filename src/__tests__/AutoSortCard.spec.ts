import AutoSortCard from '@/components/AutoSortCard.vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

function mountCard(modelValue = true) {
  return mount(AutoSortCard, {
    props: { modelValue },
  })
}

describe('AutoSortCard', () => {
  it('renders as a config card with an h2 title and the switch', () => {
    const wrapper = mountCard()

    expect(wrapper.find('[data-testid="autosort-card"]').exists()).toBe(true)
    const h2 = wrapper.find('h2.section-heading')
    expect(h2.exists()).toBe(true)
    expect(h2.text()).toBe('Automatically sort Pokemon')

    const switchInput = wrapper.find('[data-testid="autosort-switch"]')
    expect(switchInput.attributes('type')).toBe('checkbox')
    expect(switchInput.attributes('aria-label')).toBe('Automatically sort Pokemon')
  })

  it('is checked by default (modelValue true) and shows the on helper text', () => {
    const wrapper = mountCard(true)

    const input = wrapper.find('[data-testid="autosort-switch"]')
    expect((input.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('Assignments update as you add Pokémon')
    expect(wrapper.find('[data-testid="autosort-card"]').classes()).not.toContain(
      'autosort-card--off',
    )
  })

  it('emits update:modelValue when toggled', async () => {
    const wrapper = mountCard(true)

    const input = wrapper.find('[data-testid="autosort-switch"]')
    await input.setValue(false)

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('shows the off helper text and the off accent class when modelValue is false', () => {
    const wrapper = mountCard(false)

    const input = wrapper.find('[data-testid="autosort-switch"]')
    expect((input.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('New Pokémon wait unassigned while this is off')
    expect(wrapper.find('[data-testid="autosort-card"]').classes()).toContain('autosort-card--off')
  })
})
