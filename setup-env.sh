#!/usr/bin/env bash
#
# setup-env.sh — configure ANTHROPIC_API_KEY (and optional JARVIS_MODEL) in .env.local
#
# Usage:
#   ./setup-env.sh                 # interactive prompt for the key
#   ./setup-env.sh --model sonnet  # also set JARVIS_MODEL
#   ./setup-env.sh --no-verify     # skip the live API check
#
set -euo pipefail

ENV_FILE=".env.local"
EXAMPLE_FILE=".env.example"
MODEL=""
VERIFY=1

# ---------- args ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      case "${2:-}" in
        opus)   MODEL="claude-opus-4-8" ;;
        sonnet) MODEL="claude-sonnet-5" ;;
        haiku)  MODEL="claude-haiku-4-5-20251001" ;;
        "")     echo "error: --model needs a value (opus|sonnet|haiku|<model-id>)" >&2; exit 1 ;;
        *)      MODEL="$2" ;;
      esac
      shift 2
      ;;
    --no-verify) VERIFY=0; shift ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "error: unknown option '$1'" >&2; exit 1 ;;
  esac
done

# ---------- preflight ----------
if [[ ! -f "$EXAMPLE_FILE" ]]; then
  echo "error: $EXAMPLE_FILE not found. Run this from the project root." >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  read -r -p "$ENV_FILE already exists. Overwrite the key in it? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted; nothing changed."; exit 0; }
else
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from $EXAMPLE_FILE"
fi

# ---------- gitignore ----------
if [[ -f .gitignore ]] && ! grep -qxF "$ENV_FILE" .gitignore; then
  printf '\n%s\n' "$ENV_FILE" >> .gitignore
  echo "Added $ENV_FILE to .gitignore"
fi

# ---------- key ----------
echo
echo "Get a key at https://console.anthropic.com  →  API Keys  →  Create Key"
printf "Paste your ANTHROPIC_API_KEY (input hidden): "
read -rs API_KEY
echo

# strip whitespace and any quotes the user pasted along with it
API_KEY="$(printf '%s' "$API_KEY" | tr -d '[:space:]' | sed "s/^['\"]//; s/['\"]$//")"

if [[ -z "$API_KEY" ]]; then
  echo "error: no key entered." >&2
  exit 1
fi
if [[ "$API_KEY" != sk-ant-* ]]; then
  echo "warning: key does not start with 'sk-ant-'. Continuing anyway." >&2
fi

# ---------- write values ----------
# set_kv KEY VALUE — replace the line if present, otherwise append.
set_kv() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^[[:space:]]*#?[[:space:]]*${key}=" "$ENV_FILE"; then
    # rewrite in place, preserving every other line verbatim
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^[[:space:]]*#?[[:space:]]*${key}= ]]; then
        printf '%s=%s\n' "$key" "$val"
      else
        printf '%s\n' "$line"
      fi
    done < "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    rm -f "$tmp"
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

set_kv ANTHROPIC_API_KEY "$API_KEY"
echo "Set ANTHROPIC_API_KEY in $ENV_FILE"

if [[ -n "$MODEL" ]]; then
  set_kv JARVIS_MODEL "$MODEL"
  echo "Set JARVIS_MODEL=$MODEL"
fi

chmod 600 "$ENV_FILE"

# ---------- verify ----------
if [[ "$VERIFY" -eq 1 ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "note: curl not found; skipping verification."
    exit 0
  fi
  echo
  echo "Verifying key against the Anthropic API..."
  status=$(curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/messages \
    -H "x-api-key: $API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}')

  case "$status" in
    200) echo "OK — key works." ;;
    401) echo "FAILED (401) — key is invalid or revoked. Create a new one in the console." >&2; exit 1 ;;
    400) echo "Key authenticated, but the test request was rejected (400). The key itself is fine." ;;
    429) echo "Key is valid but rate-limited / out of credit (429). Check billing in the console." ;;
    *)   echo "Unexpected HTTP $status. Key was written; verify manually." >&2 ;;
  esac
fi

echo
echo "Done. $ENV_FILE is configured and gitignored."
