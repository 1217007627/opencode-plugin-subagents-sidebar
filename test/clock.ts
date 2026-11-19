import { spyOn } from "bun:test"

// Control the spinner and display-clock intervals; leave renderer scheduling real.
export function displayClock(initial: number) {
  let now = initial
  const callbacks = new Map<
    unknown,
    { delay: number; elapsed: number; run: () => void }
  >()
  const interval = globalThis.setInterval
  // The project includes DOM, Node and Bun timer overloads; this boundary uses
  // the actual Bun handles returned by the captured runtime function.
  const clear = globalThis.clearInterval as (handle: unknown) => void
  const dateSpy = spyOn(Date, "now").mockImplementation(() => now)
  const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    if ((delay === 100 || delay === 1_000) && typeof handler === "function") {
      const handle = interval(() => {}, 86_400_000)
      handle.unref()
      callbacks.set(handle, {
        delay: delay ?? 0,
        elapsed: 0,
        run: () => handler(...args),
      })
      return handle
    }
    return interval(handler, delay, ...args)
  }) as typeof globalThis.setInterval)
  const clearSpy = spyOn(globalThis, "clearInterval").mockImplementation(
    (handle) => {
      callbacks.delete(handle)
      clear(handle)
    },
  )
  return {
    get active() {
      return callbacks.size
    },
    advance(ms: number) {
      now += ms
      for (const callback of [...callbacks.values()]) {
        callback.elapsed += ms
        if (callback.elapsed >= callback.delay) {
          callback.elapsed %= callback.delay
          callback.run()
        }
      }
    },
    [Symbol.dispose]() {
      for (const handle of callbacks.keys()) clear(handle)
      callbacks.clear()
      dateSpy.mockRestore()
      intervalSpy.mockRestore()
      clearSpy.mockRestore()
    },
  }
}
