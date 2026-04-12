import FavoriteBadge from '@/components/FavoriteBadge.vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

describe('FavoriteBadge', () => {
  it('renders success variant and checkmark when fulfilled', () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', fulfilled: true },
    })
    expect(wrapper.classes()).toContain('text-bg-success')
    expect(wrapper.text()).toContain('✓')
    expect(wrapper.text()).toContain('Exercise')
  })

  it('renders danger variant and cross when not fulfilled', () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', fulfilled: false },
    })
    expect(wrapper.classes()).toContain('text-bg-danger')
    expect(wrapper.text()).toContain('✗')
    expect(wrapper.text()).toContain('Exercise')
  })

  it('renders count suffix when count prop provided', () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', fulfilled: true, count: 3 },
    })
    expect(wrapper.text()).toContain('×3')
  })

  it('omits count suffix when count prop not provided', () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', fulfilled: true },
    })
    expect(wrapper.text()).not.toContain('×')
  })

  it('emits click with favorite name when clicked', async () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', fulfilled: false },
    })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toEqual([['Exercise']])
  })

  it('emits click with favorite name on Enter keydown', async () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Cleanliness', fulfilled: false },
    })
    await wrapper.trigger('keydown.enter')
    expect(wrapper.emitted('click')).toEqual([['Cleanliness']])
  })

  it('forwards data-testid attribute to root element', () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', fulfilled: true },
      attrs: { 'data-testid': 'my-fave-badge' },
    })
    expect(wrapper.attributes('data-testid')).toBe('my-fave-badge')
  })

  it('renders secondary variant and no prefix when informational', () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', informational: true },
    })
    expect(wrapper.classes()).toContain('text-bg-secondary')
    expect(wrapper.classes()).not.toContain('text-bg-success')
    expect(wrapper.classes()).not.toContain('text-bg-danger')
    expect(wrapper.text()).not.toContain('✓')
    expect(wrapper.text()).not.toContain('✗')
    expect(wrapper.text()).toContain('Exercise')
  })

  it('informational overrides fulfilled=true', () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', fulfilled: true, informational: true },
    })
    expect(wrapper.classes()).toContain('text-bg-secondary')
    expect(wrapper.text()).not.toContain('✓')
  })

  it('emits click when informational', async () => {
    const wrapper = mount(FavoriteBadge, {
      props: { favorite: 'Exercise', informational: true },
    })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toEqual([['Exercise']])
  })
})
