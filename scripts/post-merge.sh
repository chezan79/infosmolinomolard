#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Recreate the user-level helper after isolated task merges or workspace resets.
# The Git config stores only this helper command; credentials stay in Replit
# Secrets and are read by the helper only when Git requests GitHub HTTPS auth.
bash scripts/setup-github-credential-helper.sh

# Restore dependencies after isolated task changes. This is idempotent and
# non-interactive, so it is safe for Replit's automatic post-merge hook.
npm install --no-audit --no-fund