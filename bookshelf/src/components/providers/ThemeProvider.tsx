"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useSyncExternalStore,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

// Theme store for useSyncExternalStore
let currentTheme: Theme = "light";
const listeners = new Set<() => void>();

function getTheme() {
  return currentTheme;
}

function getServerTheme() {
  return "light" as Theme;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Show a theme, without recording it as the reader's choice.
 *
 * Kept separate from setTheme because only an explicit toggle is a choice. See
 * the system-theme effect below for what went wrong when the two were one
 * function.
 */
function applyTheme(theme: Theme) {
  currentTheme = theme;
  if (typeof window !== "undefined") {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }
  listeners.forEach((listener) => listener());
}

/** Show a theme and remember it, overriding the system preference from now on. */
function setTheme(theme: Theme) {
  if (typeof window !== "undefined") {
    localStorage.setItem("theme", theme);
  }
  applyTheme(theme);
}

// Read the theme the blocking script in <head> already applied, so the store
// agrees with the DOM. The class is set there rather than here — doing it at
// module-evaluation time happens after first paint and causes a white flash.
if (typeof window !== "undefined") {
  currentTheme = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [theme]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  // Follow the system theme, for as long as the reader has not chosen one.
  //
  // `applyTheme`, not `setTheme`. The guard below reads "only follow the OS
  // while nothing is stored", but this used to call setTheme, which stores what
  // it is given — so the first OS change satisfied the guard, wrote the value,
  // and permanently failed the guard from then on. The app followed the system
  // theme exactly once. A reader who had never opened the toggle, whose laptop
  // went dark at sunset, stayed dark: back on a light desktop, and on every
  // later page load, because a preference they never expressed had been written
  // down on their behalf. Applying without storing is the whole fix.
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("theme")) {
        applyTheme(e.matches ? "dark" : "light");
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
