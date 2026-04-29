"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Homepage search input (#117). URL is the source of truth — typing
// updates `?q=` via router.replace after a 300ms debounce; pressing
// Enter submits the form natively (progressive enhancement — the
// underlying <form method="GET"> still navigates without JS). Esc
// clears the input + drops the `q` param.

type Props = {
  // Current `q` value from the URL — renders into the input so the
  // RSC-driven re-render stays consistent with the query state.
  initialQ?: string;
};

export const SearchBar = ({ initialQ = "" }: Props) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Seed once from the server-rendered URL; the input is user-owned
  // after that. External URL changes (tag pill click, pagination)
  // don't need to reset the field — the URL and the text box both
  // reflect the same `q` and updating via the commit path is the
  // only way to change it.
  const [value, setValue] = useState(initialQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const trimmed = next.trim();
    // Enforce the same 2-char floor the API requires — a 1-char
    // query would 422 and leave the user confused.
    if (trimmed.length >= 2) {
      params.set("q", trimmed);
    } else {
      params.delete("q");
    }
    // Reset page on search change — results are different; page
    // numbering from a prior filter would point to nothing.
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/");
  };

  const onChange = (raw: string) => {
    setValue(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(raw), 300);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    commit(value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setValue("");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      commit("");
    }
  };

  return (
    <form
      role="search"
      aria-label="Search articles"
      onSubmit={onSubmit}
      className="search-bar"
    >
      <label htmlFor="conduit-search" className="sr-only">
        Search articles
      </label>
      <input
        id="conduit-search"
        type="search"
        name="q"
        className="form-control"
        placeholder="Search articles by title or description"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        data-testid="search-bar-input"
      />
    </form>
  );
};
