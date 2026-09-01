import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import ThemeProvider, { useTheme } from "@/components/providers/ThemeProvider";

/**
 * Following the system theme must not be mistaken for choosing one.
 *
 * The provider is meant to track the OS until the reader picks a theme, and to
 * respect their pick afterwards. It did the first part exactly once. The
 * system-change handler was guarded by `if (!localStorage.getItem("theme"))`
 * but called `setTheme`, which writes that key — so the first OS change wrote a
 * preference the reader had never expressed, and every change after it was
 * ignored. A laptop that went dark at sunset stayed dark on a light desktop and
 * on every later page load.
 *
 * Verified against the real app before the fix, driving Chrome's emulated
 * `prefers-color-scheme`:
 *
 *   light OS, first load          dark=false  theme=null
 *   OS -> dark                    dark=true   theme="dark"   <- written
 *   OS -> light again             dark=true   theme="dark"   <- ignored
 *   fresh load on the light OS    dark=true   theme="dark"
 *
 * The module is imported once, not re-imported per test: isolating it would
 * load a second copy of React alongside the one react-dom is rendering with.
 * Its theme lives in module scope, so where a test needs a particular starting
 * theme it establishes it through the provider's own behaviour rather than by
 * reaching into the module.
 */

type Listener = (event: { matches: boolean }) => void;

/** A `prefers-color-scheme: dark` query whose value the test drives. */
function installMatchMedia(initiallyDark: boolean) {
  const listeners = new Set<Listener>();
  let matches = initiallyDark;

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, listener: Listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_: string, listener: Listener) => {
        listeners.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  });

  return {
    /** The OS theme changes under the running app. */
    change(dark: boolean) {
      matches = dark;
      act(() => {
        listeners.forEach((listener) => listener({ matches: dark }));
      });
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

const isDark = () => document.documentElement.classList.contains("dark");
const stored = () => localStorage.getItem("theme");

/**
 * Renders the provider with a real control for the toggle.
 *
 * A consumer that assigned `toggleTheme` to a variable in the enclosing scope
 * would be reassigning it during render, which react-hooks/globals rightly
 * rejects. Clicking a button is also closer to what the navbar does.
 */
function renderProvider() {
  function ToggleButton() {
    const { toggleTheme } = useTheme();
    return (
      <button type="button" onClick={toggleTheme}>
        toggle theme
      </button>
    );
  }
  render(
    <ThemeProvider>
      <ToggleButton />
    </ThemeProvider>
  );
  return {
    toggle: () =>
      fireEvent.click(screen.getByRole("button", { name: "toggle theme" })),
  };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("follows the system theme every time it changes, not just once", () => {
    const os = installMatchMedia(false);
    renderProvider();

    expect(isDark()).toBe(false);
    expect(os.listenerCount).toBe(1);

    os.change(true);
    expect(isDark()).toBe(true);

    // The assertion that failed before the fix: the app was pinned to dark
    // because following the OS had written a preference.
    os.change(false);
    expect(isDark()).toBe(false);

    os.change(true);
    expect(isDark()).toBe(true);
  });

  it("does not record a system theme as the reader's choice", () => {
    const os = installMatchMedia(false);
    renderProvider();

    os.change(true);

    // Nothing was chosen, so nothing is remembered — which is what keeps the
    // next change, and the next page load, free to follow the system again.
    expect(stored()).toBeNull();
    expect(isDark()).toBe(true);
  });

  it("remembers an explicit toggle, and then ignores the system", () => {
    const os = installMatchMedia(false);
    const { toggle } = renderProvider();

    // Establish dark the way the OS would, so the toggle has somewhere to go.
    os.change(true);
    expect(isDark()).toBe(true);
    expect(stored()).toBeNull();

    toggle();
    expect(isDark()).toBe(false);
    expect(stored()).toBe("light");

    // A chosen theme outranks the OS from here on. This is the half of the
    // behaviour that always worked, and it has to keep working: the fix must
    // not turn a real preference into one the system can overwrite.
    os.change(true);
    expect(isDark()).toBe(false);
    expect(stored()).toBe("light");
  });

  it("leaves a stored choice alone on a system with the opposite theme", () => {
    const os = installMatchMedia(true); // a dark OS
    localStorage.setItem("theme", "light"); // a reader who chose light

    renderProvider();

    // Mounting must not apply the OS theme over a stored choice, nor rewrite it.
    expect(isDark()).toBe(false);
    expect(stored()).toBe("light");

    os.change(true);
    expect(isDark()).toBe(false);
    expect(stored()).toBe("light");
  });
});
