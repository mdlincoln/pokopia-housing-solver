import { useCartStore } from '@/stores/cart'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import App from '../App.vue'

// jsdom never applies the SFC <style> block, so the non-interactive overlay
// pin (Playwright relies on the overlay never swallowing clicks) is asserted
// against the source of the rule instead of a computed style.
const APP_VUE_PATH = path.join(process.cwd(), 'src', 'App.vue')
const APP_VUE_SOURCE = readFileSync(APP_VUE_PATH, 'utf8')

function cartBusyOverlayRule() {
  const match = /\.cart-busy-overlay\s*\{([^}]*)\}/s.exec(APP_VUE_SOURCE)
  expect(match, '.cart-busy-overlay rule must exist in App.vue').not.toBeNull()
  return match![1]!
}

function mountApp() {
  return mount(App, {
    global: { plugins: [createPinia()], stubs: { ShoppingCart: true } },
  })
}

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('mounts renders properly', () => {
    const wrapper = mountApp()
    expect(wrapper.text()).toContain('Pokopia Housing Solver')
  })

  it('renders the build date in the hero card', () => {
    const wrapper = mountApp()
    const updated = wrapper.find('[data-testid="last-updated"]')
    expect(updated.exists()).toBe(true)
    expect(updated.text()).toContain('Last updated:')
    expect(updated.text()).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/)
  })

  it('shows the cart-busy overlay only after 150ms of sustained busy, then clears', async () => {
    vi.useFakeTimers()
    const wrapper = mountApp()
    const cart = useCartStore()
    const overlay = () => wrapper.find('[data-testid="cart-busy-overlay"]')

    expect(overlay().exists()).toBe(false)

    cart.pendingMutations++
    await nextTick()

    vi.advanceTimersByTime(149)
    await nextTick()
    expect(overlay().exists()).toBe(false)

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(overlay().exists()).toBe(true)
    // Click-through is a styled-class concern now (see top of file).
    expect(cartBusyOverlayRule()).toContain('pointer-events: none')
    expect(overlay().text()).toContain('Updating cart…')

    cart.pendingMutations = 0
    await nextTick()
    expect(overlay().exists()).toBe(false)
  })

  it('never shows the overlay for busy blips shorter than 150ms', async () => {
    vi.useFakeTimers()
    const wrapper = mountApp()
    const cart = useCartStore()
    const overlay = () => wrapper.find('[data-testid="cart-busy-overlay"]')

    cart.pendingMutations++
    await nextTick()
    vi.advanceTimersByTime(100)
    cart.pendingMutations = 0
    await nextTick()
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(overlay().exists()).toBe(false)

    // A new busy cycle restarts the full 150ms delay (stale timers are cleared).
    cart.pendingMutations++
    await nextTick()
    vi.advanceTimersByTime(149)
    await nextTick()
    expect(overlay().exists()).toBe(false)
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(overlay().exists()).toBe(true)
  })
})
