// Shared jsdom test environment shims.
//
// Global posthog-js mock: src/analytics.ts imports the singleton at module
// load, and posthog-js touches browser APIs jsdom does not implement. Mocking
// here registers a vi.mock applied to every test file before its imports
// resolve (Vitest applies setup-file mocks globally). The same vi.fn
// identities (posthog.capture etc.) are what analytics.spec.ts asserts on.
import { vi } from 'vitest'

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn<() => void>(),
    capture: vi.fn<() => void>(),
    captureException: vi.fn<() => void>(),
  },
}))

// jsdom does not implement window.matchMedia, but BOffcanvas (responsive)
// and the breakpoint ref in ShoppingCart call it during mount. Provide a
// minimal stub that reports "no match" for every query (desktop behavior in
// tests). Individual tests may override window.matchMedia when they need a
// specific breakpoint state.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  })
}
