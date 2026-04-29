"use client";

import { useCallback, useEffect, useRef } from "react";
import { useShortcutContext } from "./KeyboardShortcutProvider";

// Help modal (#160). Lists every keyboard shortcut the app
// supports. Rendered at the app root (inside
// KeyboardShortcutProvider) so it's available from every page.
//
// Accessibility contract:
//   - role="dialog" + aria-modal="true" + aria-labelledby on
//     the title element.
//   - Initial focus lands on the Close button so Esc + Space/
//     Enter dismiss immediately.
//   - Tab cycles within the modal (focus trap); Shift+Tab
//     wraps from the first focusable back to the last.
//   - Esc closes (handled in the provider, so even a swallowed
//     Tab doesn't lose the Esc path).
//   - Clicking outside the dialog (backdrop) also closes.

const SHORTCUTS = [
  { keys: ["?"], description: "Open this help modal" },
  { keys: ["/"], description: "Focus the search bar (homepage only)" },
  { keys: ["g", "h"], description: "Go to the homepage" },
  { keys: ["g", "p"], description: "Go to your profile" },
  { keys: ["n"], description: "Start a new article (opens the editor)" },
  { keys: ["Esc"], description: "Close this modal / dismiss dialogs" },
];

export const KeyboardShortcutHelp = () => {
  const { helpOpen, closeHelp } = useShortcutContext();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus-trap: keep Tab navigation inside the dialog while
  // it's open. Implementation queries focusables fresh on each
  // Tab press so dynamic content (future inputs, etc.) is
  // handled automatically.
  const onKeyDownTrap = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [],
  );

  // Move focus into the modal when it opens. Scoped to the
  // helpOpen transition so focus isn't yanked on every render.
  useEffect(() => {
    if (!helpOpen) return;
    // requestAnimationFrame to defer focus until the DOM has
    // painted — otherwise the Close button might not exist yet.
    const raf = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [helpOpen]);

  if (!helpOpen) return null;

  return (
    <div
      className="shortcut-help-backdrop"
      onClick={(e) => {
        // Only close on outer backdrop click, not on clicks
        // inside the dialog body.
        if (e.target === e.currentTarget) closeHelp();
      }}
      data-testid="shortcut-help-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        className="shortcut-help-dialog"
        onKeyDown={onKeyDownTrap}
        data-testid="shortcut-help"
      >
        <h2 id="shortcut-help-title" className="shortcut-help-title">
          Keyboard shortcuts
        </h2>
        <table className="shortcut-help-table">
          <tbody>
            {SHORTCUTS.map(({ keys, description }) => (
              <tr key={keys.join("+")}>
                <td className="shortcut-help-keys">
                  {keys.map((k, idx) => (
                    <span key={idx}>
                      <kbd>{k}</kbd>
                      {idx < keys.length - 1 ? <span> then </span> : null}
                    </span>
                  ))}
                </td>
                <td className="shortcut-help-desc">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="shortcut-help-actions">
          <button
            ref={closeButtonRef}
            type="button"
            className="btn btn-primary"
            onClick={closeHelp}
            data-testid="shortcut-help-close"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
