#!/bin/bash
# Temporarily move API routes out of the way for static export,
# then restore them after the build completes.
set -e

API_DIR="src/app/api"
BACKUP_DIR="src/app/_api_backup"

# Move API routes out
if [ -d "$API_DIR" ]; then
  mv "$API_DIR" "$BACKUP_DIR"
fi

# Build with static export
npm run build

# Upload source maps to Sentry (CI only — requires SENTRY_AUTH_TOKEN)
if [ -n "$SENTRY_AUTH_TOKEN" ] && command -v npx &> /dev/null; then
  npx @sentry/cli sourcemaps upload \
    --org "${SENTRY_ORG:-fragment}" \
    --project "${SENTRY_PROJECT:-fragment-desktop}" \
    --release "${npm_package_version:-0.1.0}" \
    ./out/_next/static/ || true  # Don't fail build if upload fails
fi

# Restore API routes
if [ -d "$BACKUP_DIR" ]; then
  mv "$BACKUP_DIR" "$API_DIR"
fi
