#!/bin/bash

# ci_post_clone.sh — Xcode Cloud post-clone script
# Runs automatically after the repository is cloned.
# Installs all dependencies needed to build the Baton iOS app.

set -euo pipefail

echo "=== Xcode Cloud CI: Post-Clone ==="

# -------------------------------------------------------------------
# Environment
# -------------------------------------------------------------------
# Xcode Cloud sets CI_PRIMARY_REPOSITORY_PATH to the clone root.
# Our iOS project lives at packages/mobile/ios within the monorepo.
REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
IOS_DIR="$REPO_ROOT/packages/mobile/ios"

echo "Repository root: $REPO_ROOT"
echo "iOS project dir: $IOS_DIR"

# -------------------------------------------------------------------
# 1. Node.js — Xcode Cloud includes Node 20+ but ensure availability
# -------------------------------------------------------------------
if ! command -v node &>/dev/null; then
  echo "Error: node not found" >&2
  exit 1
fi

NODE_VERSION=$(node --version)
echo "Node.js version: $NODE_VERSION"

# -------------------------------------------------------------------
# 2. pnpm — required for monorepo workspace installs
# -------------------------------------------------------------------
if ! command -v pnpm &>/dev/null; then
  echo "Installing pnpm via corepack..."
  corepack enable
  corepack prepare pnpm@10.8.1 --activate
fi

PNPM_VERSION=$(pnpm --version)
echo "pnpm version: $PNPM_VERSION"

# -------------------------------------------------------------------
# 3. Install npm dependencies (monorepo root)
# -------------------------------------------------------------------
echo ""
echo "=== Installing npm dependencies ==="
cd "$REPO_ROOT"
pnpm install --frozen-lockfile

# -------------------------------------------------------------------
# 4. Build @baton/shared (consumed via source by mobile)
# -------------------------------------------------------------------
echo ""
echo "=== Building @baton/shared ==="
pnpm --filter @baton/shared build

# -------------------------------------------------------------------
# 5. CocoaPods — install iOS native dependencies
# -------------------------------------------------------------------
echo ""
echo "=== Installing CocoaPods ==="
cd "$IOS_DIR"

# Use the version of pod that comes with the Gemfile or system
if command -v pod &>/dev/null; then
  POD_VERSION=$(pod --version)
  echo "CocoaPods version: $POD_VERSION"
  pod install
else
  echo "Installing CocoaPods via gem..."
  gem install cocoapods --no-document
  pod install
fi

echo ""
echo "=== Post-clone setup complete ==="
