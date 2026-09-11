/**
 * What a rendered test needs beyond the environment itself: Testing Library's
 * DOM matchers, and the one browser API Ant Design expects that jsdom does not
 * implement.
 *
 * Loaded through `setupFilesAfterEnv` because `@testing-library/jest-dom`
 * extends an `expect` that does not exist yet in `setupFiles`.
 */
import "@testing-library/jest-dom";

/**
 * antd's responsive components — the `Table`'s own breakpoint observer among
 * them — call `matchMedia` on mount, and jsdom leaves it undefined, so the
 * first render throws before any assertion runs.
 *
 * It answers "no match" to everything, which is the widest layout: the tests
 * assert on rows and controls, not on which breakpoint they were drawn at.
 */
Object.defineProperty(window, "matchMedia", {
  writable: true,
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
    }) as unknown as MediaQueryList,
});

/**
 * jsdom implements `getComputedStyle(element)` but throws "not implemented" the
 * moment a pseudo-element is named — and antd's `Table` names `::-webkit-
 * scrollbar` on mount, measuring a scrollbar that does not exist here. jsdom
 * only logs it, so the tests still pass; the cost is a hundred lines of stack
 * per render, which is how a real error goes unnoticed.
 *
 * Swallowing the second argument is the honest answer: there are no pseudo-
 * element styles in a DOM with no stylesheets, so the measurement is zero
 * either way.
 *
 * Declaring one parameter narrows nothing: `getComputedStyle`'s type comes from
 * `lib.dom`, and a function of fewer parameters is assignable to it, so callers
 * may still pass a pseudo-element and still typecheck. It is only ignored at
 * run time, which is the whole point.
 */
const computedStyle = window.getComputedStyle.bind(window);

window.getComputedStyle = (element: Element) => computedStyle(element);

/**
 * antd's `Select` measures its open dropdown with a `ResizeObserver`, which
 * jsdom does not implement — so the Status filter throws the moment a test
 * opens it.
 *
 * It observes nothing, which is the honest answer rather than a shortcut: jsdom
 * reports every box as zero, so a real implementation would deliver zeroes too.
 */
class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= NoopResizeObserver;

/**
 * The same `Select` defers opening and closing by a macrotask, and spells that
 * macrotask as a `MessageChannel` — it posts on one port and does the work in
 * the other's `onmessage` (`@rc-component/select/lib/hooks/useOpen`). jsdom has
 * no `MessageChannel`, so the click throws before the dropdown ever mounts.
 *
 * **Node's own is the wrong one**, even though it is a real implementation.
 * Its ports deliver on Node's event loop rather than jsdom's and they keep that
 * loop alive, so the deferred work lands nowhere `act` is watching and the run
 * hangs instead of failing — several minutes of nothing, rather than an error.
 *
 * `setTimeout` is the macrotask jsdom and Jest already agree on, so the message
 * arrives where `userEvent`'s `await` is looking for it. Only the two members
 * the hook touches are implemented; the cast is what says so out loud.
 */
class MacroTaskChannel {
  readonly port1: { onmessage: ((event: { data: unknown }) => void) | null } = {
    onmessage: null,
  };

  readonly port2 = {
    postMessage: (data: unknown) => {
      setTimeout(() => this.port1.onmessage?.({ data }), 0);
    },
  };
}

globalThis.MessageChannel ??=
  MacroTaskChannel as unknown as typeof MessageChannel;
