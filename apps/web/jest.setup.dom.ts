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
