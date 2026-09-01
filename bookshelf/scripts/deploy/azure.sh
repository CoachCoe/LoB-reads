#!/usr/bin/env bash
#
# Deploy Life on Books to Azure.
#
#   scripts/deploy/azure.sh provision --what-if   # show what would change
#   scripts/deploy/azure.sh provision             # create/update infrastructure
#   scripts/deploy/azure.sh release <image>       # migrate, then roll the app
#
# DEPLOYMENT.md is the reasoning; this is the executable form of it. Where the
# two disagree, the document is stale — but check, because this script has been
# syntax-checked and never run against a live subscription.
#
# Two orderings here are deliberate and are the whole reason this is a script:
#
#   1. Migrations run BEFORE the new image is rolled out, through DIRECT_URL,
#      and the release stops if they fail. Rolling first would put code in front
#      of a schema it does not have.
#   2. `provision` refuses to run without a preceding `--what-if` in the same
#      directory. The Bicep template has never been submitted to Azure; a
#      what-if is the only cheap way to find that out before it half-creates a
#      resource group.
set -euo pipefail

# Declared and assigned separately: `readonly X="$(cmd)"` masks the command's
# exit status, so a failed cd would sail past `set -e` with a wrong REPO_ROOT.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly REPO_ROOT
readonly INFRA_DIR="$REPO_ROOT/../infra"
WHATIF_STAMP="${TMPDIR:-/tmp}/lob-whatif-$(id -u)"
readonly WHATIF_STAMP

log()  { printf '  %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "$name is not set."
}

preflight() {
  require az "Install the Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli"
  az account show >/dev/null 2>&1 || die "Not signed in. Run: az login"
  # `az containerapp` ships as an extension. Finding that out during a release,
  # after migrations have already been applied, is the wrong time.
  az extension show --name containerapp >/dev/null 2>&1 \
    || die "the containerapp extension is missing. Run: az extension add --name containerapp"
  require_env AZURE_RESOURCE_GROUP
}

cmd_provision() {
  preflight
  require_env NAME_PREFIX
  require_env POSTGRES_ADMIN_USER
  require_env POSTGRES_ADMIN_PASSWORD
  require_env NEXTAUTH_SECRET
  require_env PUBLIC_URL
  require_env CONTAINER_IMAGE

  local -a params=(
    "namePrefix=$NAME_PREFIX"
    "postgresAdminUser=$POSTGRES_ADMIN_USER"
    "postgresAdminPassword=$POSTGRES_ADMIN_PASSWORD"
    "nextAuthSecret=$NEXTAUTH_SECRET"
    "publicUrl=$PUBLIC_URL"
    "containerImage=$CONTAINER_IMAGE"
  )

  if [[ "${1:-}" == "--what-if" ]]; then
    log "what-if against $AZURE_RESOURCE_GROUP"
    az deployment group what-if \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --template-file "$INFRA_DIR/main.bicep" \
      --parameters "${params[@]}"
    date +%s > "$WHATIF_STAMP"
    log "reviewed? re-run without --what-if to apply"
    return 0
  fi

  # The template has never been deployed. Insisting on a recent what-if is the
  # cheapest guard against finding that out halfway through.
  [[ -f "$WHATIF_STAMP" ]] || die "run 'provision --what-if' first and read the output"
  local stamped
  stamped="$(cat "$WHATIF_STAMP")"
  [[ "$stamped" =~ ^[0-9]+$ ]] || die "the what-if stamp is unreadable; run 'provision --what-if' again"
  local age=$(( $(date +%s) - stamped ))
  (( age < 3600 )) || die "the last what-if was $((age / 60)) minutes ago; run it again"

  log "deploying to $AZURE_RESOURCE_GROUP"
  az deployment group create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --template-file "$INFRA_DIR/main.bicep" \
    --parameters "${params[@]}"
}

cmd_release() {
  local image="${1:-}"
  [[ -n "$image" ]] || die "usage: azure.sh release <image>"
  preflight
  require_env CONTAINER_APP_NAME
  require_env DIRECT_URL

  # Migrations first, and through the direct connection. migrate-deploy.sh
  # refuses a pooled URL itself — advisory locks and DDL do not survive a
  # transaction-mode pooler — so this only has to not undermine it.
  log "applying migrations"
  DIRECT_URL="$DIRECT_URL" "$REPO_ROOT/scripts/db/migrate-deploy.sh"

  log "rolling $CONTAINER_APP_NAME to $image"
  az containerapp update \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --image "$image"

  # The same checks that gate CI, now against the deployed configuration.
  log "verifying the deployment"
  ( cd "$REPO_ROOT" && npm run --silent deploy:verify )
}

main() {
  case "${1:-}" in
    provision) shift; cmd_provision "$@" ;;
    release)   shift; cmd_release "$@" ;;
    *) cat >&2 <<USAGE
usage:
  azure.sh provision --what-if   show what would change
  azure.sh provision             create or update infrastructure
  azure.sh release <image>       migrate, roll the app, verify

environment:
  provision  AZURE_RESOURCE_GROUP NAME_PREFIX POSTGRES_ADMIN_USER
             POSTGRES_ADMIN_PASSWORD NEXTAUTH_SECRET PUBLIC_URL CONTAINER_IMAGE
  release    AZURE_RESOURCE_GROUP CONTAINER_APP_NAME DIRECT_URL
USAGE
       exit 2 ;;
  esac
}

main "$@"
