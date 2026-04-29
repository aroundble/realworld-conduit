"use client";

import { useState, type KeyboardEvent, type ChangeEvent } from "react";

type Props = {
  // The form reads tags from a hidden input with this name so the
  // server action sees them alongside the rest of the editor form.
  name: string;
  initialTags?: string[];
};

// Controlled tag input for the editor (#19). Enter or comma commits
// the current input as a pill; pills show a × button to remove. Empty
// and duplicate tags are rejected silently — the spec doesn't call
// them out as errors, and the rejection keeps the list tidy without
// surprising the user.
export const TagInput = ({ name, initialTags = [] }: Props) => {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const next = raw.trim();
    if (next.length === 0) return;
    setTags((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      // Backspace on an empty draft pops the last pill — matches the
      // idiom used by most chip inputs (Material, react-tag-input).
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // If the user pastes / types a comma in the middle of text, commit
    // everything up to the comma as a pill and keep the remainder.
    if (raw.includes(",")) {
      const parts = raw.split(",");
      for (let i = 0; i < parts.length - 1; i++) {
        commit(parts[i]);
      }
      setDraft(parts[parts.length - 1]);
    } else {
      setDraft(raw);
    }
  };

  const remove = (tag: string) =>
    setTags((prev) => prev.filter((t) => t !== tag));

  return (
    <fieldset className="form-group">
      <input
        type="text"
        className="form-control"
        placeholder="Enter tags"
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
        aria-label="Enter tags"
      />
      <div className="tag-list" data-testid="tag-list">
        {tags.map((tag) => (
          <span
            key={tag}
            className="tag-default tag-pill"
            data-testid={`tag-pill-${tag}`}
          >
            <button
              type="button"
              className="ion-close-round"
              aria-label={`Remove tag ${tag}`}
              onClick={() => remove(tag)}
            >
              ×
            </button>{" "}
            {tag}
          </span>
        ))}
      </div>
      {/* Hidden input ferries the committed pill list to the server
          action as a JSON string; the schema transform decodes it. */}
      <input type="hidden" name={name} value={JSON.stringify(tags)} />
    </fieldset>
  );
};
