import { useMatchMedia } from '@/composables/useMatchMedia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

const Host = defineComponent({
  setup() {
    const matches = useMatchMedia('(max-width: 992px)', false)
    return { matches }
  },
  template: '<span data-testid="matches">{{ matches }}</span>',
})

interface FakeMediaQueryList {
  matches: boolean
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  listeners: Set<(event: MediaQueryListEvent) => void>
  dispatch(event: MediaQueryListEvent): void
}

function fakeMediaQueryList(matches: boolean): FakeMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  return {
    matches,
    addEventListener: vi.fn<(_type: string, cb: (event: MediaQueryListEvent) => void) => void>(
      (_type: string, cb: (event: MediaQueryListEvent) => void) => {
        listeners.add(cb)
      },
    ),
    removeEventListener: vi.fn<(_type: string, cb: (event: MediaQueryListEvent) => void) => void>(
      (_type: string, cb: (event: MediaQueryListEvent) => void) => {
        listeners.delete(cb)
      },
    ),
    listeners,
    dispatch(event: MediaQueryListEvent) {
      for (const listener of listeners) listener(event)
    },
  }
}

const makeEvent = (matches: boolean): MediaQueryListEvent =>
  ({ matches, media: '(max-width: 992px)' }) as MediaQueryListEvent

let mql: FakeMediaQueryList

describe('useMatchMedia', () => {
  beforeEach(() => {
    mql = fakeMediaQueryList(false)
    vi.stubGlobal(
      'matchMedia',
      vi.fn<() => FakeMediaQueryList>(() => mql),
    )
  })

  it('starts with the caller-supplied initial value', async () => {
    const wrapper = mount(Host)
    expect(wrapper.text()).toBe('false')
    expect(wrapper.get('[data-testid="matches"]').text()).toBe('false')
  })

  it('syncs to the media query on mount', async () => {
    mql.matches = true
    const wrapper = mount(Host)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="matches"]').text() === 'true').toBe(true)
  })

  it('updates on change events', async () => {
    const wrapper = mount(Host)
    mql.dispatch(makeEvent(true))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="matches"]').text() === 'true').toBe(true)
  })

  it('unregisters the change listener on unmount', async () => {
    const wrapper = mount(Host)
    wrapper.unmount()
    expect(mql.removeEventListener).toHaveBeenCalled()
    expect(mql.listeners.size).toBe(0)
    // Dispatching after unmount must not throw or mutate the (now gone) ref.
    expect(() => mql.dispatch(makeEvent(true))).not.toThrow()
  })
})
