#!/usr/bin/env bash
# GitHub 라벨 동기화 — .github/labels.yml 기준.
#
# claim:* 3종만 신규 등록 (멀티 세션 자동 pickup 용). 기존 라벨은 색/설명 update.
#
# 의존성: python3 + pyyaml, gh
# 사용법: ./scripts/session-labels-sync.sh
set -euo pipefail

REPO="${HARNESS_REPO:-your-org/your-repo}"
YAML="$(cd "$(dirname "$0")/.." && pwd)/.github/labels.yml"

python3 -c "import yaml" >/dev/null 2>&1 || {
  echo "PyYAML 필요: pip install pyyaml" >&2
  exit 1
}

while IFS=$'\t' read -r name color desc; do
  [[ -z "$name" ]] && continue
  if gh label list --repo "$REPO" --search "$name" --json name -q '.[].name' | grep -qx "$name"; then
    gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    echo "  updated  $name"
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    echo "  created  $name"
  fi
done < <(python3 -c "
import yaml
with open('$YAML') as f:
    for l in yaml.safe_load(f):
        print(f\"{l['name']}\t{l['color']}\t{l['description']}\")
")
