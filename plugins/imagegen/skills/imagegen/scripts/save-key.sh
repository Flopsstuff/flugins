#!/usr/bin/env bash
# Store the Gemini API key read from stdin. Never pass the key as an argument:
# argv is visible in the process list and in shell history.
set -euo pipefail

umask 077

KEY_FILE="${HOME}/.secrets/gemini-api.key"

key="$(cat)"
key="$(printf '%s' "$key" | tr -d '[:space:]')"

if [ -z "$key" ]; then
  echo "save-key.sh: nothing on stdin - expected the API key there." >&2
  exit 1
fi

mkdir -p "$(dirname "$KEY_FILE")"
printf '%s' "$key" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

echo "Saved ${#key}-character key to ${KEY_FILE} (mode 600)."
