// URL-hash state sync for HomeView. Owns the base64 JSON round-trip, the
// restoringFromUrl flag, and the reactive hash watcher. `encodeState` (the
// state builder) and `restoreState` (the shared restore glue) stay on the
// HomeView side; this composable just wires them to the hash.

import { formatUnmappedAlert, type RestoreResult } from '@/entityUpgrade'
import { type SharedState } from '@/composables/useSavedQueries'
import { watch, type WatchSource } from 'vue'

interface UseUrlStateSyncOptions {
  encodeState: () => string
  restoreState: (query: SharedState) => Promise<RestoreResult>
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
    const result = await restoreState(shared)

    // An upgraded restore (tombstoned names mapped, or unmapped ones dropped)
    // rewrites the hash so a copied/shared URL carries canonical names. The
    // reactive hash watcher stays suppressed while restoringFromUrl is true,
    // so the replace here doesn't feed back into an encode.
    if (result.upgraded) {
      history.replaceState(null, '', '#' + encodeState())
    }

    // Deferred to a macrotask so Vue's microtask render flush completes and
    // the restored island is visible behind the native dialog (run from
    // onMounted, a synchronous alert would block bootstrap).
    if (result.unmapped.length > 0) {
      setTimeout(() => window.alert(formatUnmappedAlert(result.unmapped)), 0)
    }

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
