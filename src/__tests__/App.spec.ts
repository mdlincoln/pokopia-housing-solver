import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '../App.vue'

describe('App', () => {
  it('mounts renders properly', () => {
    const wrapper = mount(App, {
      global: { stubs: { ShoppingCart: true } },
    })
    expect(wrapper.text()).toContain('Pokopia Housing Solver')
  })
})
