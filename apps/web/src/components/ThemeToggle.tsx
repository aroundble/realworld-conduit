"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

// Stable empty subscriber + server-snapshot = "mounted" flips true
// once React hydrates on the client. We don't need to react to any
// mutation, only the boundary between SSR and client — that's what
// getServerSnapshot returning `false` + getSnapshot returning `true`
// achieves, without tripping React 19's "no setState in effect" rule
// (the canonical next-themes pattern uses `useEffect(() => setMounted(true))`
// which the rule flags).
const noopSubscribe = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;
const useIsMounted = (): boolean =>
  useSyncExternalStore(noopSubscribe, clientTrue, serverFalse);

// Three-state theme cycle (#136): System (auto) → Light → Dark → System.
//
// Hydration guard: `next-themes` can only resolve the effective
// theme after the component mounts (the SSR render has no access to
// localStorage or prefers-color-scheme). Rendering the icon
// unconditionally would mismatch the SSR HTML and log a hydration
// warning. We defer the label/icon until `mounted` so SSR emits a
// neutral "Toggle theme" state, and the client upgrades it after
// hydration — no flash, no mismatch.

type Mode = "system" | "light" | "dark";

const cycle = (current: Mode): Mode => {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
};

const label: Record<Mode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const glyph: Record<Mode, string> = {
  // Single-character glyphs keep the button width stable as the
  // state cycles — no layout shift across the three modes.
  system: "◐",
  light: "☀",
  dark: "☾",
};

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();

  // Pre-hydration: render a neutral button so the SSR pass matches
  // the post-mount pass well enough that React's hydration diff
  // only has to update the text content — no server/client split
  // the page router will flag.
  const mode: Mode = mounted && (theme === "light" || theme === "dark")
    ? theme
    : "system";

  const onClick = () => {
    setTheme(cycle(mode));
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onClick}
      aria-label={`Toggle theme (current: ${label[mode]})`}
      aria-pressed={mode !== "system"}
      data-state={mode}
      data-testid="theme-toggle"
    >
      <span aria-hidden="true">{glyph[mode]}</span>
      <span className="theme-toggle-label">{label[mode]}</span>
    </button>
  );
};
