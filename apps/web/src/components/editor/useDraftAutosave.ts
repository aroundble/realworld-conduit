"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// Editor draft autosave (#137). Writes form state to localStorage on a
// 3-second debounce while the user types; restores on return; clears
// on successful submit.
//
// Uncontrolled-form friendly: the editor uses `defaultValue` on its
// inputs (form state lives in the DOM, not React state), so this
// hook attaches to the form element via ref and grabs the current
// values by reading the DOM on each debounce tick. That keeps the
// form's rendering path simple and avoids a wholesale rewrite to
// controlled state.
//
// Private-window / quota-exceeded safe: every localStorage call is
// try/caught. Hook surfaces a `hasStorage` flag so the UI can hide
// the restore banner when storage is unavailable.

const DEBOUNCE_MS = 3000;

// Mount guard via useSyncExternalStore — SSR snapshot returns
// false, client snapshot returns true. React 19 flags
// `useEffect(() => setMounted(true))` as "no setState in effect",
// so this is the canonical replacement.
const mountedSubscribe = (): (() => void) => () => {};
const mountedClient = (): boolean => true;
const mountedServer = (): boolean => false;

// Serialized payload shape. savedAt = epoch millis at write time so
// the restore banner can compute "N minutes ago" client-side.
export type DraftPayload = {
  title: string;
  description: string;
  body: string;
  tagList: string[];
  savedAt: number;
};

export type DraftKey = `conduit-draft-${"new" | `edit-${string}`}`;

export const draftKeyFor = (slug: string | undefined): DraftKey =>
  slug ? `conduit-draft-edit-${slug}` : "conduit-draft-new";

// Try/catch shell so quota-exceeded, SecurityError (private Safari),
// and disabled-localStorage browsers don't surface as console errors
// or thrown exceptions in React event handlers.
const safeRead = (key: string): DraftPayload | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftPayload>;
    if (
      typeof parsed.title === "string" &&
      typeof parsed.description === "string" &&
      typeof parsed.body === "string" &&
      Array.isArray(parsed.tagList) &&
      typeof parsed.savedAt === "number"
    ) {
      return parsed as DraftPayload;
    }
    return null;
  } catch {
    return null;
  }
};

const safeWrite = (key: string, value: DraftPayload): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded, disabled storage, or private mode — silently
    // drop the write. The user's form is still intact in the DOM.
  }
};

const safeRemove = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

const hasLocalStorage = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const probeKey = "__conduit-storage-probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
};

// Read a field out of the form by `name=`. Form elements with the
// same `name` show up once (regular inputs / textarea) or many
// times (checkbox groups). Tag list is a comma-separated hidden
// input in our TagInput component, so we split here.
const readField = (form: HTMLFormElement, name: string): string => {
  const el = form.elements.namedItem(name);
  if (!el) return "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return "";
};

const readTagList = (form: HTMLFormElement, name: string): string[] => {
  const raw = readField(form, name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
};

const snapshotForm = (form: HTMLFormElement): Omit<DraftPayload, "savedAt"> => ({
  title: readField(form, "title"),
  description: readField(form, "description"),
  body: readField(form, "body"),
  tagList: readTagList(form, "tagList"),
});

const isEmptyDraft = (snap: Omit<DraftPayload, "savedAt">): boolean =>
  snap.title === "" &&
  snap.description === "" &&
  snap.body === "" &&
  snap.tagList.length === 0;

export type UseDraftAutosaveResult = {
  // Ref to attach to the <form> element.
  formRef: (el: HTMLFormElement | null) => void;
  // Restored draft (null if none was saved).
  restoredDraft: DraftPayload | null;
  // Call after Keep / Discard dismisses the banner so the hook
  // stops reporting a restoredDraft.
  dismissRestore: () => void;
  // Explicitly discard the draft from storage (Discard button
  // handler).
  discard: () => void;
  // Explicitly clear the draft from storage (success-submit
  // handler). Same effect as `discard` but named for the caller's
  // intent.
  clear: () => void;
  // False when localStorage isn't available (private mode, quota).
  hasStorage: boolean;
};

export const useDraftAutosave = (
  draftKey: DraftKey,
): UseDraftAutosaveResult => {
  // Stable ref to the form so listeners / timers survive re-renders
  // without detaching. We also store the timeout id here so
  // consecutive keystrokes reset the debounce window.
  const formEl = useRef<HTMLFormElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `useSyncExternalStore` with a no-op subscriber + split
  // server/client snapshots returns `true` on the client, `false`
  // on SSR — same hydration pattern as next-themes (#136). We
  // gate the draft lookup on this so SSR emits `null` (matching
  // post-hydration initial state) and the client swaps in the
  // saved draft after hydration commits.
  const mounted = useSyncExternalStore(
    mountedSubscribe,
    mountedClient,
    mountedServer,
  );
  const [dismissed, setDismissed] = useState(false);
  // Snapshot the draft ONCE per mount via useMemo keyed on
  // `mounted` — flips from false on SSR to true on client, then
  // stays stable. Any subsequent autosave write (triggered by the
  // user typing in this same session) won't retrigger the read, so
  // the banner doesn't surface mid-edit showing what was just
  // written. `draftKey` is also stable for the mount's lifetime
  // (changing it means navigating to a different editor).
  const initialDraft = useMemo<DraftPayload | null>(
    () => (mounted ? safeRead(draftKey) : null),
    [mounted, draftKey],
  );
  const restoredDraft: DraftPayload | null =
    mounted && !dismissed ? initialDraft : null;
  const [hasStorage] = useState<boolean>(() => hasLocalStorage());

  const persist = useCallback(() => {
    const form = formEl.current;
    if (!form || !hasStorage) return;
    const snap = snapshotForm(form);
    // Skip writing a fully-empty draft — otherwise the banner
    // surfaces on a pristine editor the user just opened and
    // blurred without typing.
    if (isEmptyDraft(snap)) {
      safeRemove(draftKey);
      return;
    }
    safeWrite(draftKey, { ...snap, savedAt: Date.now() });
  }, [draftKey, hasStorage]);

  const onInput = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(persist, DEBOUNCE_MS);
  }, [persist]);

  const attach = useCallback(
    (form: HTMLFormElement | null) => {
      // Detach previous listener (if any) before attaching a new
      // one. React dev mode's double-invocation can re-run this
      // with stale refs otherwise.
      if (formEl.current && formEl.current !== form) {
        formEl.current.removeEventListener("input", onInput);
      }
      formEl.current = form;
      if (form) {
        form.addEventListener("input", onInput);
      }
    },
    [onInput],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (formEl.current) {
        formEl.current.removeEventListener("input", onInput);
      }
    };
  }, [onInput]);

  const dismissRestore = useCallback(() => setDismissed(true), []);

  const discard = useCallback(() => {
    safeRemove(draftKey);
    setDismissed(true);
  }, [draftKey]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    safeRemove(draftKey);
  }, [draftKey]);

  return {
    formRef: attach,
    restoredDraft,
    dismissRestore,
    discard,
    clear,
    hasStorage,
  };
};
