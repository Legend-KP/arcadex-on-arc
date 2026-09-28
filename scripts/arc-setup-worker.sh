#!/usr/bin/env bash
# Step 3 helper — D1 migrations + Worker secrets checklist for Arc.
# Does NOT print secret values. Run from repo root after `wrangler login`.
set -euo pipefail

ENV_NAME="${1:-preview}" # preview | production
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== ArcadeX Arc Worker setup ($ENV_NAME) =="
echo

if ! command -v wrangler >/dev/null 2>&1 && ! npx wrangler --version >/dev/null 2>&1; then
  echo "Install wrangler (npm i) first."
  exit 1
fi

WR="npx wrangler"

echo "1) Confirm wrangler.jsonc D1 / KV ids are NEW Arc ids (not arcadex-celo)."
echo "   File: wrangler.jsonc → env.$ENV_NAME"
echo

echo "2) Apply D1 migrations on the NEW Arc database:"
echo "   $WR d1 migrations apply arcadex-arc-${ENV_NAME/production/prod} --env $ENV_NAME"
echo "   (or use your database_name from wrangler.jsonc)"
echo

if [[ "$ENV_NAME" == "preview" ]]; then
  DB_NAME="arcadex-arc-preview"
else
  DB_NAME="arcadex-arc-prod"
fi

echo "Running migrations for $DB_NAME (env=$ENV_NAME)..."
$WR d1 migrations apply "$DB_NAME" --env "$ENV_NAME" || {
  echo
  echo "Migration command failed — fix database_name / database_id in wrangler.jsonc, then retry:"
  echo "  npx wrangler d1 migrations apply $DB_NAME --env $ENV_NAME"
}

echo
echo "3) Set Worker secrets (you will be prompted; values stay local):"
echo "   Required:"
echo "     WALLET_SESSION_SECRET"
echo "     FIREBASE_PROJECT_ID"
echo "     FIREBASE_CLIENT_EMAIL"
echo "     FIREBASE_PRIVATE_KEY"
echo "     FIREBASE_DATABASE_URL"
echo "     SPIN_RESULT_PRIVATE_KEY"
echo "   Optional:"
echo "     ADMIN_PASSWORD"
echo "     ALLOWED_CORS_ORIGINS"
echo
echo "Example:"
echo "  npx wrangler secret put WALLET_SESSION_SECRET --env $ENV_NAME"
echo "  npx wrangler secret put FIREBASE_PROJECT_ID --env $ENV_NAME"
echo "  npx wrangler secret put FIREBASE_CLIENT_EMAIL --env $ENV_NAME"
echo "  npx wrangler secret put FIREBASE_PRIVATE_KEY --env $ENV_NAME"
echo "  npx wrangler secret put FIREBASE_DATABASE_URL --env $ENV_NAME"
echo "  npx wrangler secret put SPIN_RESULT_PRIVATE_KEY --env $ENV_NAME"
echo
echo "4) Set public contract vars (Dashboard → Workers → Settings → Variables),"
echo "   or after deploy: npm run print-env --prefix contract-deploy"
echo "   then paste NEXT_PUBLIC_* values and redeploy."
echo
echo "5) Redeploy:"
echo "   npm run deploy:$ENV_NAME"
