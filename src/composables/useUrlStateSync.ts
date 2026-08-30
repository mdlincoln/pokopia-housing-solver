// URL-hash state sync for HomeView. Owns the base64 JSON round-trip, the
// restoringFromUrl flag, and the reactive hash watcher. `encodeState` (the
// state builder) and `restoreState` (the shared restore glue) stay on the
// HomeView side; this composable just wires them to the hash.

import { type SharedState } from '@/composables/useSavedQueries'
import { watch, type WatchSource } from 'vue'

interface UseUrlStateSyncOptions {
  encodeState: () => string
  restoreState: (query: SharedState) => Promise<void>
  sources: WatchSource<unknown>[]
}

export function useUrlStateSync({ encodeState, restoreState, sources }: UseUrlStateSyncOptions) {
  let restoringFromUrl = false

  function decodeStateFromUrl(): SharedState | null {
    const hash = window.location.hash.slice(1)
    if (!hash) return null
    try {
      return JSON.parse(atob(hash))
    } catch {
      return null
    }
  }

  async function restoreFromHash() {
    const shared = decodeStateFromUrl()
    if (!shared) return
    restoringFromUrl = true
    await restoreState(shared)
    restoringFromUrl = false
  }

  watch(
    sources,
    () => {
      if (restoringFromUrl) return
      const encoded = encodeState()
      if (window.location.hash === '#' + encoded) return
      history.replaceState(null, '', '#' + encoded)
    },
    { deep: true },
  )

  return { restoreFromHash }
}
