// Shared jsdom test environment shims.
//
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
