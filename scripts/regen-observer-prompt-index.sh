#!/usr/bin/env bash
# regen-observer-prompt-index — rebuild docs/HISTORY/observer-prompts/INDEX.md
#
# Reads every op-NNN-*.md file's frontmatter and produces a
# sorted table. The counterpart to observer-injections.md:
# observer-injections.md is the *metric* (counts, accuracy,
# effect phrases). INDEX.md is the *registry* (every prompt
# file's location + its frontmatter at a glance).
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HERE/docs/HISTORY/observer-prompts"
OUT="$DIR/INDEX.md"

if [[ ! -d "$DIR" ]]; then
  echo "ERROR: $DIR does not exist" >&2
  exit 1
fi

# Extract a frontmatter field from a markdown file.
fm() {
  local file="$1" field="$2"
  awk -v f="$field" 'BEGIN{inside=0} /^---$/ {inside=!inside; next} inside && $0 ~ "^"f": " {sub("^"f": +", ""); print; exit}' "$file"
}

{
  echo "# Observer-prompt index"
  echo ""
  echo "_Auto-generated. Do not hand-edit. Re-run \`bash scripts/regen-observer-prompt-index.sh\` after adding a new \`op-*.md\` file._"
  echo ""
  echo "| # | Timestamp (UTC) | Pilot | Category | Accuracy | Effect | File |"
  echo "|---|---|---|---|---|---|---|"

  find "$DIR" -maxdepth 1 -type f -name 'op-*.md' | sort | while read -r f; do
    id=$(fm "$f" op_id)
    ts=$(fm "$f" timestamp_utc)
    pilot=$(fm "$f" pilot)
    cat=$(fm "$f" category)
    acc=$(fm "$f" sentence_accuracy)
    eff=$(fm "$f" effect_summary)
    rel="$(basename "$f")"
    echo "| $id | $ts | $pilot | $cat | $acc | $eff | [$rel]($rel) |"
  done
} > "$OUT"

count=$(find "$DIR" -maxdepth 1 -type f -name 'op-*.md' | wc -l)
echo "regenerated $OUT ($count entries)"
