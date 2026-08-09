#!/usr/bin/env bash
# ============================================================
# BoundBuild → GitHub push helper
# Run this on YOUR LAPTOP, inside the downloaded "boundbuild" folder.
# It pushes the whole app to github.com/BoundBuild/BoundBuild,
# replacing the placeholder README-only repo.
# ============================================================
set -e

REPO_URL="https://github.com/BoundBuild/BoundBuild.git"

# --- locate the app root (folder containing package.json) ---
if [ -f package.json ]; then
  ROOT="."
elif [ -f boundbuild/package.json ]; then
  ROOT="boundbuild"
elif [ -f BoundBuild/package.json ]; then
  ROOT="BoundBuild"
else
  echo "✘ Can't find package.json here or one folder down."
  echo "  Download the 'boundbuild' folder from the workspace and unzip it first."
  exit 1
fi
cd "$ROOT"
echo "App root: $(pwd)"

# --- git init (safe if already a repo) ---
git init -q -b main 2>/dev/null || { git init -q; git branch -M main 2>/dev/null || true; }

# --- identity (change to your own if you want the commit attributed to you) ---
if ! git config user.name >/dev/null 2>&1; then git config user.name "BoundBuild Dev"; fi
if ! git config user.email >/dev/null 2>&1; then git config user.email "dev@boundbuild.app"; fi

# --- commit everything (data/, uploads/, .env are gitignored) ---
git add -A
git commit -q -m "BoundBuild MVP v0.1.0" || echo "(nothing new to commit)"

# --- point at your repo ---
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

# --- push ---
echo "Pushing to $REPO_URL …"
if git push -u origin main; then
  echo "✔ Pushed. Confirm at https://github.com/BoundBuild/BoundBuild"
else
  echo ""
  echo "Push was rejected: the remote 'main' branch holds the placeholder README"
  echo "with an unrelated history. It contains no code, so force-pushing is safe."
  read -r -p "Force-push to replace it? (y/N) " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    git push -u origin main --force
    echo "✔ Force-pushed."
  else
    echo "Aborted — re-run when ready."
    exit 1
  fi
fi

echo ""
echo "Next steps:"
echo "  1. Render → your Web Service → 'Manual Deploy' → 'Deploy latest commit'"
echo "     (or push triggers auto-deploy if you enabled it)"
echo "  2. Watch the build log: npm install → start → 'BoundBuild MVP running'"
echo "  3. Open  https://YOUR-APP.onrender.com/api/health  → expect {\"ok\":true}"
echo "  4. Set env vars first (BB_PUBLIC_URL, RESEND_API_KEY, persistent disk) — see DEPLOY.md"
