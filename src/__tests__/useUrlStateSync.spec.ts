import { useUrlStateSync } from '@/composables/useUrlStateSync'
import type { RestoreResult } from '@/entityUpgrade'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'

interface State {
  n: number
  pokemon: string[]
}

// Minimal clean RestoreResult used by the restoreState stubs: the composable
// only branches on `upgraded` and `unmapped`, neither set in these tests.
const CLEAN_RESTORE_RESULT: RestoreResult = {
  state: { version: 2, small: 0, medium: 0, large: 0, pokemon: [] },
  unmapped: [],
  upgraded: false,
}

const encode = (s: State) => btoa(JSON.stringify(s))

const Host = defineComponent({
  setup() {
    const s = ref<State>({ n: 0, pokemon: [] })
    const deferredRestores: Array<{ resolve: () => void }> = []
    const api = useUrlStateSync({
      encodeState: () => encode(s.value),
      restoreState: async () =>
        new Promise<RestoreResult>((resolve) => {
          deferredRestores.push({ resolve: () => resolve(CLEAN_RESTORE_RESULT) })
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
            return new Promise<RestoreResult>((res) => (release = () => res(CLEAN_RESTORE_RESULT)))
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

  it('rewrites the hash once when restoreState upgrades, while keeping the watcher suppressed', async () => {
    const queued: State = { n: 42, pokemon: ['OldName'] }
    window.location.hash = '#' + encode(queued)

    const replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {})

    const wrapper = mount(UpgradedHost)
    const promise = wrapper.vm.api.restoreFromHash()
    await nextTick()
    // The restore is pending, and the watcher is suppressed regardless.
    expect(replaceState).not.toHaveBeenCalled()

    wrapper.vm.deferredRestores.forEach((d) => d.resolve())
    await promise

    // Exactly one replace: the composable's own upgrade rewrite via the
    // shared encodeState option. No watcher-driven re-encode afterwards.
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(replaceState).toHaveBeenCalledWith(null, '', '#' + encode(wrapper.vm.s))
    replaceState.mockRestore()
  })

  it('leaves the hash bytes unchanged and alerts nobody on a clean restore', async () => {
    const queued: State = { n: 7, pokemon: ['Pikachu'] }
    window.location.hash = '#' + encode(queued)

    const replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {})
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})

    const wrapper = mount(Host)
    const promise = wrapper.vm.api.restoreFromHash()
    await nextTick()
    wrapper.vm.deferredRestores.forEach((d) => d.resolve())
    await promise
    await new Promise((r) => setTimeout(r, 0))

    expect(replaceState).not.toHaveBeenCalled()
    expect(alert).not.toHaveBeenCalled()
    replaceState.mockRestore()
    alert.mockRestore()
  })

  it('re-encodes via the suppressed watcher branch when a clean restore leaves the hash stale', async () => {
    // restored state differs from the queued hash: with upgraded=false the
    // composable must NOT rewrite the hash itself (restoreState returning
    // upgraded=false means no hash write from restoreFromHash).
    const queued: State = { n: 7, pokemon: ['Pikachu'] }
    window.location.hash = '#' + encode(queued)

    const replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {})

    const wrapper = mount(Host)
    const promise = wrapper.vm.api.restoreFromHash()
    await nextTick()
    wrapper.vm.deferredRestores.forEach((d) => d.resolve())
    await promise

    expect(replaceState).not.toHaveBeenCalled()
    replaceState.mockRestore()
  })
})

// A host whose restoreState releases with an *upgraded* RestoreResult when
// triggered, so the restore-result branches (hash rewrite) can be driven.
const UpgradedHost = defineComponent({
  setup() {
    const s = ref<State>({ n: 0, pokemon: [] })
    const deferredRestores: Array<{ resolve: () => void }> = []
    const api = useUrlStateSync({
      encodeState: () => encode(s.value),
      restoreState: async () =>
        new Promise<RestoreResult>((resolve) => {
          deferredRestores.push({ resolve: () => resolve(UPGRADED_RESTORE_RESULT) })
        }),
      sources: [s],
    })
    return { s, api, deferredRestores }
  },
  template: '<div />',
})

const UPGRADED_RESTORE_RESULT: RestoreResult = {
  state: { version: 2, small: 1, medium: 2, large: 1, pokemon: ['NewName'] },
  unmapped: [],
  upgraded: true,
}

// A host that releases with an upgraded restore that also dropped entities,
// proving the deferred macrotask alert fires and its timing (after restore).
const UnmappedHost = defineComponent({
  setup() {
    const s = ref<State>({ n: 0, pokemon: [] })
    const deferredRestores: Array<{ resolve: () => void }> = []
    const api = useUrlStateSync({
      encodeState: () => encode(s.value),
      restoreState: async () =>
        new Promise<RestoreResult>((resolve) => {
          deferredRestores.push({
            resolve: () =>
              resolve({
                state: { version: 2, small: 1, medium: 0, large: 0, pokemon: ['NewName'] },
                unmapped: [{ type: 'pokemon', name: 'GhostMon' }],
                upgraded: true,
              }),
          })
        }),
      sources: [s],
    })
    return { s, api, deferredRestores }
  },
  template: '<div />',
})

describe('unmapped-entity alert (deferred macrotask)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.location.hash = ''
  })

  it('fires once after the restore completes, not while it is pending', async () => {
    const queued: State = { n: 3, pokemon: ['GhostMon'] }
    window.location.hash = '#' + encode(queued)

    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})

    const wrapper = mount(UnmappedHost)
    const promise = wrapper.vm.api.restoreFromHash()
    await nextTick()
    expect(alert).not.toHaveBeenCalled() // still pending

    wrapper.vm.deferredRestores.forEach((d) => d.resolve())
    await promise
    expect(alert).not.toHaveBeenCalled() // not yet: deferred to a macrotask

    await new Promise((r) => setTimeout(r, 0))
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('GhostMon'))
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('Try searching'))
    alert.mockRestore()
  })
})
