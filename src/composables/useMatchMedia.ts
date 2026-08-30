// A minimal matchMedia composable: tracks a media query with change-listener
// cleanup on unmount. Extracted from ShoppingCart.vue so the breakpoint sync
// logic is reusable and unit-testable. The initial value is captured by the
// caller synchronously (before mount) so a below-lg page load never spends a
// frame with the wrong breakpoint state.

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useMatchMedia(query: string, initial: boolean): Ref<boolean> {
  const matches = ref(initial)
  let mediaQuery: MediaQueryList | undefined

  function sync(event?: MediaQueryListEvent) {
    matches.value = event ? event.matches : (mediaQuery?.matches ?? false)
  }

  onMounted(() => {
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia(query)
      sync()
      mediaQuery.addEventListener('change', sync)
    }
  })

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', sync)
  })

  return matches
}
