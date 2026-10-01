#!/usr/bin/env bash
set -euo pipefail

# Node 22.12 bundles Corepack 0.29.4. That release only trusts the previous
# npm registry key, so `pnpm` exits with "Cannot find matching keyid" before
# it reads the packageManager field. Install a Corepack that has the current key.
npm install -g corepack@latest
corepack enable
corepack prepare pnpm@8.15.0 --activate

pnpm install --frozen-lockfile --prod=false
pnpm --filter @euthyna/api... build
