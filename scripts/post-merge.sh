#!/bin/bash
set -euo pipefail

# Restore dependencies after isolated task changes. This is idempotent and
# non-interactive, so it is safe for Replit's automatic post-merge hook.
npm install --no-audit --no-fund