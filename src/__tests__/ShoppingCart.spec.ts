import ShoppingCart from '@/components/ShoppingCart.vue'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { flushPromises, mount } from '@vue/test-utils'
import { BOffcanvas } from 'bootstrap-vue-next'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

function makeMatchMediaStub(matches: boolean) {
  return (query: string): MediaQueryList =>
    ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

const desktopMatchMedia = makeMatchMediaStub(false)
const mobileMatchMedia = makeMatchMediaStub(true)

let pinia: Pinia

// Attached hosts so the focus-return assertion works in jsdom (focus needs the
// element in the document). Removed after each test to avoid cross-test DOM
// pollution, since the toggle is located via document.querySelector.
const hosts: HTMLElement[] = []

// BOffcanvas lazy-renders its teleported content after mount, so always flush
// before querying the offcanvas DOM.
async function mountCart() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  const wrapper = mount(ShoppingCart, { attachTo: host, global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  window.matchMedia = desktopMatchMedia
})

afterEach(() => {
  // Restore the shared "no match" stub from src/__tests__/setup.ts
  window.matchMedia = desktopMatchMedia
  for (const host of hosts) host.remove()
  hosts.length = 0
})

describe('ShoppingCart mobile toggle (AC.1 wiring)', () => {
  it('renders a labeled toggle wired to the offcanvas via aria-controls', async () => {
    const wrapper = await mountCart()

    const toggle = wrapper.find('[data-testid="cart-mobile-toggle"]')
    expect(toggle.exists()).toBe(true)
    // Below-lg only: Bootstrap display utility hides it at lg+
    expect(toggle.classes()).toContain('d-lg-none')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe('Open shopping cart, 0 items')

    const targetId = toggle.attributes('aria-controls')
    expect(targetId).toBeTruthy()
    expect(wrapper.find(`#${targetId}`).exists()).toBe(true)
  })

  it('shows the item count in the badge and aria label', async () => {
    const cart = useCartStore()
    await cart.restoreItems([
      { houseId: 'L1', name: 'Punching Bag' },
      { houseId: 'L1', name: 'Berry Pots' },
    ])
    await flushPromises()

    const wrapper = await mountCart()
    const toggle = wrapper.find('[data-testid="cart-mobile-toggle"]')
    expect(toggle.text()).toContain('2')
    expect(toggle.attributes('aria-label')).toBe('Open shopping cart, 2 items')
  })

  it('opens on toggle click below lg and closes via update:model-value', async () => {
    window.matchMedia = mobileMatchMedia
    const wrapper = await mountCart()
    await flushPromises()

    const toggle = wrapper.find('[data-testid="cart-mobile-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    // Hidden while the overlay is open
    expect((toggle.element as HTMLElement).style.display).toBe('none')

    // The offcanvas's close interactions surface as update:modelValue(false)
    wrapper.findComponent(BOffcanvas).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect((toggle.element as HTMLElement).style.display).not.toBe('none')

    // Focus returns to the floating toggle (ARIA dialog dismissal pattern)
    expect(document.activeElement).toBe(toggle.element)
  })

  it('keeps the offcanvas open at desktop regardless of the mobile model', async () => {
    const wrapper = await mountCart()
    const offcanvas = wrapper.findComponent(BOffcanvas)
    // isBelowLg=false → model forced true so desktop inline rendering matches a
    // model-less BOffcanvas
    expect(offcanvas.props('modelValue')).toBe(true)
  })
})

describe('ShoppingCart orphaned house annotation (AC.5)', () => {
  it('annotates a cart group whose house is no longer in the registry', async () => {
    const cart = useCartStore()
    await cart.restoreItems([{ houseId: 'L1', name: 'Punching Bag' }])
    await flushPromises()

    const wrapper = await mountCart()
    const group = wrapper.find('[data-testid="cart-house-group"]')
    expect(group.exists()).toBe(true)
    expect(group.classes()).toContain('cart-house-group--orphan')

    const note = wrapper.find('[data-testid="cart-orphan-note"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('House L1 no longer exists')
    expect(note.text()).toContain('kept in case you re-add a large house')

    // Controls must stay functional — removal is still possible
    const remove = wrapper.find('[data-testid="cart-remove"]')
    expect(remove.exists()).toBe(true)
    await remove.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="cart-orphan-note"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cart-empty"]').exists()).toBe(true)
  })

  it('renders no annotation for a house that still exists in the registry', async () => {
    const houseStore = useHouseStore()
    houseStore.reconcileHouses({ small: 0, medium: 0, large: 1 }, new Set())
    expect(houseStore.registry.has('L1')).toBe(true)

    const cart = useCartStore()
    await cart.restoreItems([{ houseId: 'L1', name: 'Punching Bag' }])
    await flushPromises()

    const wrapper = await mountCart()
    const group = wrapper.find('[data-testid="cart-house-group"]')
    expect(group.classes()).not.toContain('cart-house-group--orphan')
    expect(wrapper.find('[data-testid="cart-orphan-note"]').exists()).toBe(false)
  })

  it('labels cart-remove buttons with item name and house id (AC.4)', async () => {
    const cart = useCartStore()
    await cart.restoreItems([{ houseId: 'S2', name: 'Punching Bag' }])
    await flushPromises()

    const wrapper = await mountCart()
    const remove = wrapper.find('[data-testid="cart-remove"]')
    expect(remove.attributes('aria-label')).toBe('Remove Punching Bag from house S2 cart')
  })
})

describe('ShoppingCart quiet-close class contracts', () => {
  async function mountWithTwoItems() {
    const cart = useCartStore()
    await cart.restoreItems([
      { houseId: 'L1', name: 'Punching Bag' },
      { houseId: 'L1', name: 'Berry Pots' },
    ])
    await flushPromises()
    const wrapper = await mountCart()
    return { wrapper, cart }
  }

  it('renders cart-remove as a quiet btn-close item-remove button (AC.1)', async () => {
    const { wrapper } = await mountWithTwoItems()
    const remove = wrapper.find('[data-testid="cart-remove"]')
    expect(remove.element.tagName).toBe('BUTTON')
    expect(remove.classes()).toContain('btn-close')
    expect(remove.classes()).toContain('item-remove')
    expect(remove.classes()).not.toContain('btn-outline-danger')
    expect(remove.classes()).not.toContain('btn-sm')
    // aria-label is carried through to the rendered button by attr fallthrough
    expect(remove.attributes('aria-label')).toContain('Remove')
  })

  it('keeps cart-clear as the sole loud outline-danger control (AC.4)', async () => {
    const { wrapper } = await mountWithTwoItems()
    const clear = wrapper.find('[data-testid="cart-clear"]')
    expect(clear.element.tagName).toBe('BUTTON')
    expect(clear.classes()).toContain('btn-outline-danger')
    expect(clear.classes()).not.toContain('btn-close')
    expect(clear.classes()).not.toContain('item-remove')
    expect(clear.text()).toContain('Clear all')
  })
})
