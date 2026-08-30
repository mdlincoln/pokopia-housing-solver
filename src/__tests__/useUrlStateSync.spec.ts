import { useUrlStateSync } from '@/composables/useUrlStateSync'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'

interface State {
  n: number
  pokemon: string[]
}

const encode = (s: State) => btoa(JSON.stringify(s))

const Host = defineComponent({
  setup() {
    const s = ref<State>({ n: 0, pokemon: [] })
    const deferredRestores: Array<{ resolve: () => void }> = []
    const api = useUrlStateSync({
      encodeState: () => encode(s.value),
      restoreState: async () =>
        new Promise<void>((resolve) => {
          deferredRestores.push({ resolve })
        }),
      sources: [s],
    })
    return { s, api, deferredRestores }
  },
  template: '<div />',
})

describe('useUrlStateSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.location.hash = ''
  })

  it('writes the base64-encoded state to the hash when a source changes', async () => {
    const replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {})
    const wrapper = mount(Host)

    const next: State = { n: 5, pokemon: ['Pikachu'] }
    wrapper.vm.s = next
    await wrapper.vm.$nextTick()

    expect(replaceState).toHaveBeenCalledWith(null, '', '#' + encode(next))
    replaceState.mockRestore()
  })

  it('skips the write when the hash already matches the encoded state', async () => {
    const initial: State = { n: 5, pokemon: ['Pikachu'] }
    window.location.hash = '#' + encode(initial)

    const wrapper = mount(Host)
    wrapper.vm.s = initial
    const replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {})
    await wrapper.vm.$nextTick()

    expect(replaceState).not.toHaveBeenCalled()
    replaceState.mockRestore()
  })

  it('round-trips state through restoreFromHash via the decode path', async () => {
    const queued: State = { n: 42, pokemon: ['Pikachu'] }
    window.location.hash = '#' + encode(queued)

    const restored: State[] = []
    let release!: () => void
    const Host2 = defineComponent({
      setup() {
        const s = ref<State>({ n: 0, pokemon: [] })
        const api = useUrlStateSync({
          encodeState: () => encode(s.value),
          restoreState: async (query) => {
            restored.push(query as unknown as State)
            return new Promise<void>((res) => (release = res))
          },
          sources: [s],
        })
        return { s, api, restored }
      },
      template: '<div />',
    })

    const wrapper = mount(Host2)
    const promise = wrapper.vm.api.restoreFromHash()
    await wrapper.vm.$nextTick()
    expect(restored).toEqual([queued])

    // While the restore is pending, source changes must not fire replaceState.
    const replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {})
    wrapper.vm.s = { n: 1, pokemon: [] }
    await wrapper.vm.$nextTick()
    expect(replaceState).not.toHaveBeenCalled()
    replaceState.mockRestore()

    release()
    await promise
  })
})
