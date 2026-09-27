#!/usr/bin/env bash
# Self-test for the closing-keyword regex used in .github/workflows/close-on-dev.yml.
set -euo pipefail

WF="$(dirname "$0")/../workflows/close-on-dev.yml"
KW_RE=$(grep -oP "(?<=KW_RE=')[^']*" "$WF")

fail=0

assert_no_match() {
  local text="$1"
  if printf '%s\n' "$text" | grep -oiE "$KW_RE" >/dev/null; then
    echo "FAIL: expected no match for: $text"
    fail=1
  else
    echo "ok (no match): $text"
  fi
}

assert_match() {
  local text="$1" expected="$2"
  local got
  got=$(printf '%s\n' "$text" | grep -oiE "$KW_RE" | grep -oE '#[0-9]+' | tr -d '#' | sort -un | tr '\n' ' ')
  got=${got% }
  if [ "$got" != "$expected" ]; then
    echo "FAIL: '$text' -> got [$got], want [$expected]"
    fail=1
  else
    echo "ok ($expected): $text"
  fi
}

assert_no_match "Unresolved: #641"
assert_no_match "hotfix #12"
assert_no_match "prefixed #7"

assert_match "Closes #1, #2 and #3" "1 2 3"
assert_match "(fixes #9)" "9"
assert_match "Resolved #4" "4"

exit $fail
