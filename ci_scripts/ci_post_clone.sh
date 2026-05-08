#!/bin/bash

# ci_post_clone.sh — Xcode Cloud post-clone script
# Runs automatically after the repository is cloned.
# Installs all dependencies needed to build the Baton iOS app.

# Don't use 'set -e' — if pnpm install fails we still need pod install
# to generate Pods/ so Xcode can find the xcconfig files. Without Pods/,
# the build fails immediately with "Unable to open base configuration".
set -uo pipefail

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
if ! pnpm install --frozen-lockfile; then
  echo "WARNING: pnpm install --frozen-lockfile failed, retrying without frozen lockfile..."
  pnpm install || echo "WARNING: pnpm install failed, continuing anyway..."
fi

# -------------------------------------------------------------------
# 4. Build @baton/shared (consumed via source by mobile)
# -------------------------------------------------------------------
echo ""
echo "=== Building @baton/shared ==="
pnpm --filter @baton/shared build || echo "WARNING: @baton/shared build failed, continuing..."

# -------------------------------------------------------------------
# 5. CocoaPods — install iOS native dependencies (MUST succeed)
# -------------------------------------------------------------------
echo ""
echo "=== Installing CocoaPods ==="
cd "$IOS_DIR"

if ! command -v pod &>/dev/null; then
  echo "Installing CocoaPods via gem..."
  gem install cocoapods --no-document
fi

POD_VERSION=$(pod --version)
echo "CocoaPods version: $POD_VERSION"

# pod install MUST succeed — without it, the Pods/ directory is empty
# and Xcode cannot find Pods-Baton.release.xcconfig (exit code 65).
pod install || {
  echo "ERROR: pod install failed, attempting pod install --repo-update..."
  pod install --repo-update || {
    echo "FATAL: pod install failed. Cannot continue." >&2
    exit 1
  }
}

echo ""
echo "=== Verifying Pods configuration ==="
if [[ -f "Pods/Target Support Files/Pods-Baton/Pods-Baton.release.xcconfig" ]]; then
  echo "✓ Pods-Baton.release.xcconfig exists"
else
  echo "✗ Pods-Baton.release.xcconfig NOT found — build will fail!" >&2
  exit 1
fi

echo ""
echo "=== Post-clone setup complete ==="
