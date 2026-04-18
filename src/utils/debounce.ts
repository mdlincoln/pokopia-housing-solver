export interface Debounced<A extends unknown[]> {
  (...args: A): void
  cancel(): void
  flush(): void
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: A | null = null

  const debounced = ((...args: A) => {
    // wait === 0 is a bypass for tests and ssr: run synchronously so callers
    // that only use microtask-based flushing observe the call immediately.
    if (wait === 0) {
      fn(...args)
      return
    }
    pendingArgs = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const toRun = pendingArgs!
      pendingArgs = null
      fn(...toRun)
    }, wait)
  }) as Debounced<A>

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pendingArgs = null
  }

  debounced.flush = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
    const toRun = pendingArgs!
    pendingArgs = null
    fn(...toRun)
  }

  return debounced
}
