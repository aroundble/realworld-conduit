"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Global keyboard-shortcut runtime (#160). Owns:
//   - `?` opens the help modal
//   - `/` focuses the SearchBar
//   - `g h` navigates to /
//   - `g p` navigates to /profile/<viewer>  (falls back to /login if anon)
//   - `n` opens the editor (falls back to /login if anon)
//   - `Esc` closes any open modal
//
// Sequence shortcuts (`g h`, `g p`) use a simple timeout-based
// state machine: the first key enters "g-prefix" state; a second
// key within 1s triggers the action; otherwise the prefix
// expires.
//
// Guard: every shortcut checks whether focus is inside a text
// input / textarea / contenteditable, and skips if so. Otherwise
// typing a `?` in an article body would open the modal.

type ShortcutContextValue = {
  // Dispatched by KeyboardShortcutHelp's Close button + by any
  // other caller that wants to open / close the help modal.
  openHelp: () => void;
  closeHelp: () => void;
  helpOpen: boolean;
};

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export const useShortcutContext = (): ShortcutContextValue => {
  const ctx = useContext(ShortcutContext);
  if (!ctx) {
    throw new Error(
      "useShortcutContext must be used inside <KeyboardShortcutProvider>",
    );
  }
  return ctx;
};

// True when focus is on an element that should swallow the
// keystroke as text input (input, textarea, contenteditable,
// select). Modal dialog controls (role=dialog children) also
// need to preserve Esc + Tab, but those are handled by the
// modal's own handlers.
const isTextInputFocused = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
};

// Read the current viewer's username from the `conduit-user`
// cookie, same convention Navbar uses. Returns null for anon.
const readViewerUsername = (): string | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )conduit-user=([^;]+)/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]!);
    // Cookie may be a bare username or JSON. Handle both.
    if (decoded.startsWith("{")) {
      const parsed = JSON.parse(decoded) as { username?: string };
      return parsed.username ?? null;
    }
    return decoded;
  } catch {
    return null;
  }
};

const SEQUENCE_TIMEOUT_MS = 1000;

type Props = { children: ReactNode };

export const KeyboardShortcutProvider = ({ children }: Props) => {
  const router = useRouter();
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);
  // Pre-open-modal focused element so we can restore focus on
  // close (accessibility requirement — the user's tab position
  // shouldn't get lost when they dismiss a modal).
  const prevFocusRef = useRef<HTMLElement | null>(null);
  // Sequence state: tracks whether we just saw the prefix key
  // (`g`) and expects a second press within SEQUENCE_TIMEOUT_MS.
  const seqPrefixRef = useRef<string | null>(null);
  const seqTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openHelp = useCallback(() => {
    if (helpOpen) return;
    if (typeof document !== "undefined") {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
    }
    setHelpOpen(true);
  }, [helpOpen]);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    // Restore focus to whatever had it before the modal opened.
    // Defer to next frame so the modal's unmount completes
    // before we try to focus the old element (otherwise focus
    // lands on body).
    const prev = prevFocusRef.current;
    if (prev && typeof prev.focus === "function") {
      requestAnimationFrame(() => prev.focus());
    }
  }, []);

  const navigate = useCallback(
    (path: string, requireAuth = false) => {
      if (requireAuth && readViewerUsername() === null) {
        router.push(`/login?redirect=${encodeURIComponent(path)}`);
        return;
      }
      router.push(path);
    },
    [router],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Shortcuts inside the help modal: only Esc is honored
      // (close). Tab cycling is handled by the modal's own trap.
      if (helpOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeHelp();
        }
        return;
      }

      // Text-input guard: shortcuts don't fire while the user
      // is typing. Applies even to modifier-free keys like `?`
      // because typing `?` in an article body is the common
      // case; opening the help modal mid-paragraph would be
      // a UX regression.
      if (isTextInputFocused(event.target)) return;

      // `?` (Shift+/ or bare `?`) opens the help modal.
      if (event.key === "?") {
        event.preventDefault();
        openHelp();
        return;
      }

      // Modifier keys (Ctrl/Cmd/Alt/Meta) are reserved for
      // browser + OS shortcuts. Never hijack.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // `/` focuses the search bar — homepage only. On other
      // pages it's a no-op (typing `/` does nothing because
      // there's no input to focus).
      if (event.key === "/") {
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], [role="searchbox"], input[name="q"]',
        );
        if (searchInput) {
          event.preventDefault();
          searchInput.focus();
          searchInput.setSelectionRange(
            searchInput.value.length,
            searchInput.value.length,
          );
        }
        return;
      }

      // `g` enters sequence-prefix state, waiting for the
      // second key (h / p).
      if (event.key === "g") {
        event.preventDefault();
        seqPrefixRef.current = "g";
        if (seqTimerRef.current !== null) clearTimeout(seqTimerRef.current);
        seqTimerRef.current = setTimeout(() => {
          seqPrefixRef.current = null;
        }, SEQUENCE_TIMEOUT_MS);
        return;
      }

      // Sequence follow-up keys: `g h` → home, `g p` → profile.
      if (seqPrefixRef.current === "g") {
        seqPrefixRef.current = null;
        if (seqTimerRef.current !== null) clearTimeout(seqTimerRef.current);
        if (event.key === "h") {
          event.preventDefault();
          navigate("/");
          return;
        }
        if (event.key === "p") {
          event.preventDefault();
          const viewer = readViewerUsername();
          if (viewer) {
            navigate(`/profile/${encodeURIComponent(viewer)}`);
          } else {
            navigate("/profile", true);
          }
          return;
        }
        // Unknown follow-up key — drop through; the sequence is
        // cancelled either way.
      }

      // `n` opens the editor (authed) or routes to /login.
      if (event.key === "n") {
        event.preventDefault();
        navigate("/editor", true);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    // Ready marker for e2e: set once the keydown listener is
    // actually attached. Without this, Playwright races the
    // listener — a `page.keyboard.press("n")` fired before
    // hydration finishes is silently dropped.
    document.body.dataset.shortcutsReady = "1";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (seqTimerRef.current !== null) clearTimeout(seqTimerRef.current);
      delete document.body.dataset.shortcutsReady;
    };
  }, [helpOpen, openHelp, closeHelp, navigate]);

  // Deliberate non-feature: the modal does NOT auto-close on
  // pathname change. Users dismiss it themselves with Esc or
  // the Close button. React 19's combined "no setState in
  // effect" + "no ref access during render" rules make the
  // auto-close awkward to express without violating one or the
  // other; since the modal's content is navigation-invariant
  // (the shortcut list is the same on every page), leaving it
  // open across a transition is a reasonable default.
  void pathname;

  return (
    <ShortcutContext.Provider value={{ openHelp, closeHelp, helpOpen }}>
      {children}
    </ShortcutContext.Provider>
  );
};
