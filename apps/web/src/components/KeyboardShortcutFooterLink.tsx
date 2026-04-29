"use client";

import { useShortcutContext } from "./KeyboardShortcutProvider";

// Footer trigger for the keyboard-shortcuts help modal (#160).
// Styled as a bare button that looks like a link — screen
// readers treat it as a button (correct, since it opens a
// dialog rather than navigating), but visually it sits inside
// the footer alongside the Thinkster + RealWorld-spec links.

export const KeyboardShortcutFooterLink = () => {
  const { openHelp } = useShortcutContext();
  return (
    <button
      type="button"
      className="shortcut-help-footer-link"
      onClick={openHelp}
      data-testid="shortcut-help-trigger"
    >
      Keyboard shortcuts (?)
    </button>
  );
};
