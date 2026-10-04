#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${GIT_URL:-}" ]]; then
  echo "GIT_URL secret is unavailable; skipped GitHub credential-helper setup." >&2
  exit 0
fi

helper_path="$HOME/.local/bin/git-credential-replit-github"
config_key="credential.https://github.com.helper"
install -D -m 0700 scripts/git-credential-replit-github "$helper_path"

configure_file() {
  local config_file="$1"
  local canonical_file
  canonical_file="$(realpath -m "$config_file")"
  case "$canonical_file" in
    "$ROOT_DIR"/*)
      echo "Refusing to place user Git configuration inside the repository." >&2
      return 1
      ;;
  esac

  mkdir -p "$(dirname "$canonical_file")"
  git config --file "$canonical_file" --unset-all "$config_key" >/dev/null 2>&1 || true
  git config --file "$canonical_file" --add "$config_key" ''
  git config --file "$canonical_file" --add "$config_key" "!$helper_path"
}

if [[ -n "${GIT_CONFIG_GLOBAL:-}" && "$GIT_CONFIG_GLOBAL" != "/dev/null" ]]; then
  configure_file "$GIT_CONFIG_GLOBAL"
  home_config="$(realpath -m "$HOME/.gitconfig")"
  if [[ "$home_config" != "$(realpath -m "$GIT_CONFIG_GLOBAL")" ]]; then
    configure_file "$home_config"
  fi
else
  git config --global --unset-all "$config_key" >/dev/null 2>&1 || true
  git config --global --add "$config_key" ''
  git config --global --add "$config_key" "!$helper_path"
fi

echo "Configured the user-level GitHub-only credential helper."