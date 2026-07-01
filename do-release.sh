#!/usr/bin/env bash
# do-release.sh
# Build release artifacts, commit, tag, push, and create a GitHub release
# for the svellheim-symbaroum Foundry VTT module.
#
# Usage:
#   1. Set COMMIT_MSG below (or pass as $1).
#   2. Run:  bash do-release.sh
#   3. Or:   bash do-release.sh "release: v0.1.1 — initial symbaroum conversion"
#
# Prerequisites: git, gh (GitHub CLI), node, zip

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_ID="svellheim-symbaroum"
COMMIT_MSG="${1:-release: patch release}"

# ── Helpers ───────────────────────────────────────────────────────────────────

bump_patch() {
  local v="$1"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$v"
  echo "${major}.${minor}.$((patch + 1))"
}

stamp_module_json() {
  local file="$1" old="$2" new="$3"
  sed -i \
    -e "s|\"version\": \"${old}\"|\"version\": \"${new}\"|g" \
    -e "s|/v${old}/|/v${new}/|g" \
    -e "s|-v${old}.zip|-v${new}.zip|g" \
    "$file"
}

# ── Read current version ─────────────────────────────────────────────────────

OLD_VER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${REPO_DIR}/module.json','utf8')).version)")
NEW_VER=$(bump_patch "$OLD_VER")
TAG="v${NEW_VER}"

echo ""
echo "=== ${MODULE_ID} : ${OLD_VER} → ${NEW_VER} ==="
echo ""

# ── 1. Stamp version in ALL module.json files ────────────────────────────────
stamp_module_json "${REPO_DIR}/module.json"              "$OLD_VER" "$NEW_VER"
stamp_module_json "${REPO_DIR}/module/module.json"       "$OLD_VER" "$NEW_VER"
stamp_module_json "${REPO_DIR}/dist-release/module.json" "$OLD_VER" "$NEW_VER"
echo "  ✓ Stamped version ${NEW_VER} (root + module/ + dist-release/)"

# ── 2. Run conversions & build packs ─────────────────────────────────────────
echo "  Building..."
cd "$REPO_DIR"
node tools/convert-monsters.js
node tools/convert-npcs.js
node tools/convert-items.js
node tools/convert-journals.js
node tools/build-packs.js
echo "  ✓ Conversions & packs built"

# ── 3. Create release zip ────────────────────────────────────────────────────
DIST_DIR="${REPO_DIR}/dist/foundry"
mkdir -p "$DIST_DIR"

ZIP_NAME="${MODULE_ID}-v${NEW_VER}.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_NAME}"

# Create temp dir with module contents under the module ID folder name
TMPDIR=$(mktemp -d)
cp -r "${REPO_DIR}/module" "${TMPDIR}/${MODULE_ID}"

# Remove any .gitkeep or temp files
find "${TMPDIR}/${MODULE_ID}" -name '.gitkeep' -delete 2>/dev/null || true

# Build zip from temp dir so the zip root is <moduleId>/
rm -f "$ZIP_PATH"
(cd "$TMPDIR" && zip -r "$ZIP_PATH" "${MODULE_ID}/")
rm -rf "$TMPDIR"

echo "  ✓ Zip: ${ZIP_NAME}"

# ── 4. Copy manifest to dist/foundry/ ────────────────────────────────────────
cp "${REPO_DIR}/module/module.json" "${DIST_DIR}/module.json"
echo "  ✓ Manifest: dist/foundry/module.json"

# ── 5. Commit ─────────────────────────────────────────────────────────────────
cd "$REPO_DIR"
git add -A
git commit -m "$COMMIT_MSG"
echo "  ✓ Committed: ${COMMIT_MSG}"

# ── 6. Tag ────────────────────────────────────────────────────────────────────
git tag "$TAG"
echo "  ✓ Tagged: ${TAG}"

# ── 7. Push branch + tag ─────────────────────────────────────────────────────
git push origin main
git push origin "$TAG"
echo "  ✓ Pushed"

# ── 8. Create GitHub release ─────────────────────────────────────────────────
REPO_SLUG=$(git remote get-url origin | sed 's|https://github.com/||;s|\.git$||')
gh release create "$TAG" \
  "$ZIP_PATH" \
  "${DIST_DIR}/module.json" \
  --repo "$REPO_SLUG" \
  --title "$TAG" \
  --notes "Release ${TAG}"
echo ""
echo "  ✓ GitHub release created: ${TAG}"
echo ""
echo "=== Install URL ==="
echo "https://github.com/${REPO_SLUG}/releases/latest/download/module.json"
echo ""
