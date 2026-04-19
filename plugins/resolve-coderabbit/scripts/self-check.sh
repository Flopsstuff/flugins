#!/usr/bin/env bash
#
# resolve-coderabbit plugin — dependency self-check.
#
# Verifies that everything the `resolve-coderabbit` skill needs is installed
# and configured before the skill touches a PR. Run it as the very first step
# of the skill workflow. When it exits non-zero, the skill must load
# docs/setup-dependencies.md (relative to this plugin) and walk the user
# through the missing pieces — not proceed with the PR loop.
#
# Exit codes:
#   0  all dependencies OK
#   1  one or more dependencies missing or misconfigured
#
# Usage (from the skill):
#   bash "${CLAUDE_PLUGIN_ROOT}/scripts/self-check.sh"

set -u

missing=()

mark_ok()   { printf '  \xe2\x9c\x85 %s\n' "$1"; }
mark_fail() { printf '  \xe2\x9d\x8c %s\n' "$1"; missing+=("$2"); }

check_cmd() {
  local label="$1"
  local cmd="$2"
  local tag="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    local path
    path="$(command -v "$cmd")"
    mark_ok "$label — found at $path"
  else
    mark_fail "$label — not found in PATH" "$tag"
  fi
}

echo "=== resolve-coderabbit: dependency self-check ==="
echo ""
echo "Required tools:"

check_cmd "git"            git "git"
check_cmd "gh (GitHub CLI)" gh  "gh"
check_cmd "jq"             jq  "jq"

echo ""
echo "Runtime state:"

if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    mark_ok "gh auth — logged in"
  else
    mark_fail "gh auth — not authenticated (run: gh auth login)" "gh-auth"
  fi
else
  mark_fail "gh auth — cannot check (gh not installed)" "gh-auth"
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mark_ok "git repo — inside a working tree"
else
  mark_fail "git repo — not inside a git working tree (cd into your project)" "git-repo"
fi

echo ""

if [ "${#missing[@]}" -eq 0 ]; then
  echo "All dependencies OK — safe to proceed."
  exit 0
fi

echo "Missing or misconfigured: ${missing[*]}"
echo ""
echo "Next step: open docs/setup-dependencies.md (alongside this script) and"
echo "follow the section(s) matching the tags above. Re-run this script"
echo "after fixing each issue; the skill must stay paused until it exits 0."
exit 1
