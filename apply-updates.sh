#!/bin/zsh
set -euo pipefail

REPO="/Users/kishore/Codex_Development/IB7thSyllabus"
D=~/Downloads

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Jarvis — Applying feature updates"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: Create new route folders ─────────────────────────────────────────
echo "[1/5] Creating new API route folders..."
mkdir -p "$REPO/app/api/config"
mkdir -p "$REPO/app/api/session"
mkdir -p "$REPO/app/api/images"
mkdir -p "$REPO/app/api/tts"
mkdir -p "$REPO/app/api/elevenlabs/voices"
echo "    ✓ Folders created"

# ── Step 2: Copy all downloaded files ────────────────────────────────────────
echo "[2/5] Copying files..."

cp "$D/config-route.ts"              "$REPO/app/api/config/route.ts"
cp "$D/session-route.ts"             "$REPO/app/api/session/route.ts"
cp "$D/images-route.ts"              "$REPO/app/api/images/route.ts"
cp "$D/tts-route.ts"                 "$REPO/app/api/tts/route.ts"
cp "$D/elevenlabs-voices-route.ts"   "$REPO/app/api/elevenlabs/voices/route.ts"
cp "$D/prompts.ts"                   "$REPO/lib/prompts.ts"
cp "$D/AdminPortal.tsx"              "$REPO/components/AdminPortal.tsx"
cp "$D/StudentApp.tsx"               "$REPO/components/StudentApp.tsx"

echo "    ✓ All 8 files copied"

# ── Step 3: Build ─────────────────────────────────────────────────────────────
echo "[3/5] Running build..."
cd "$REPO"
npm run build 2>&1 | tail -40

# ── Step 4: Commit and push ───────────────────────────────────────────────────
echo "[4/5] Committing and pushing..."
git add -A
git commit -m "Add ElevenLabs voice, session persistence, image resources, UI overhaul"
git push
echo "    ✓ Pushed to GitHub"

# ── Step 5: Deploy to Vercel ──────────────────────────────────────────────────
echo "[5/5] Deploying to Vercel..."
vercel --prod

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Done!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Open https://ib7.vercel.app/admin"
echo "  2. Go to Config and API Keys tab"
echo "  3. Paste your ElevenLabs API key and save"
echo "  4. Click Test connection to verify voices"
echo "  5. Students pick their voice from the mic button in the sidebar"
