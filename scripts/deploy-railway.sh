#!/usr/bin/env bash
# Auto-deploy Data Talks to Railway.
#
# Usage:
#   scripts/deploy-railway.sh            # deploy to currently-linked service
#   scripts/deploy-railway.sh --init     # first-time setup: log in + link + provision Postgres
#   scripts/deploy-railway.sh --sync-env # push backend/.env to Railway variables
#   scripts/deploy-railway.sh --logs     # tail deploy logs after pushing
#
# Requirements:
#   - Railway CLI v3+ (https://docs.railway.app/guides/cli)
#   - A Railway account and, for --init, interactive terminal to complete browser auth
#
# What it does:
#   1. Verifies the CLI is installed and you're authenticated.
#   2. Verifies the current directory is linked to a Railway project+service
#      (or prompts for `railway link` when --init is passed).
#   3. Optionally syncs backend/.env → Railway variables (--sync-env).
#   4. Runs `railway up` from the repo root (Dockerfile handles build + migrate).
#   5. Optionally tails logs once deploy starts (--logs).
#
# Safety:
#   - Never commits or prints secret values.
#   - --sync-env skips empty values and asks for confirmation before uploading.
#   - Exits on first failure (set -euo pipefail).

set -euo pipefail

# ---------------------------------------------------------------------------
# Pretty-printing helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m';
    YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m';
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET="";
fi
info()  { printf "%s▶%s %s\n" "$BLUE" "$RESET" "$*"; }
ok()    { printf "%s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn()  { printf "%s!%s %s\n" "$YELLOW" "$RESET" "$*"; }
fail()  { printf "%s✗%s %s\n" "$RED" "$RESET" "$*" >&2; }
die()   { fail "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Resolve repo root — run from anywhere, always operate on the repo root so
# `railway up` picks up Dockerfile + railway.toml.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
MODE_INIT=0
MODE_SYNC_ENV=0
MODE_LOGS=0
for arg in "$@"; do
    case "$arg" in
        --init)     MODE_INIT=1 ;;
        --sync-env) MODE_SYNC_ENV=1 ;;
        --logs)     MODE_LOGS=1 ;;
        -h|--help)
            sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            die "Unknown argument: $arg. Try --help."
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
if ! command -v railway >/dev/null 2>&1; then
    fail "Railway CLI not found."
    cat <<'EOF'

Install it with one of:

  macOS/Linux:  brew install railway
  npm:          npm i -g @railway/cli
  curl:         bash <(curl -fsSL cli.new)

Then re-run this script.
EOF
    exit 1
fi
ok "Railway CLI: $(railway --version 2>&1 | head -1)"

# Check auth. `railway whoami` exits non-zero when not logged in.
if ! railway whoami >/dev/null 2>&1; then
    if [ "$MODE_INIT" -eq 1 ]; then
        info "Not logged in. Opening browser for authentication..."
        railway login
    else
        fail "You are not logged into Railway. Run: scripts/deploy-railway.sh --init"
        exit 1
    fi
fi
ok "Authenticated as: $(railway whoami 2>/dev/null | head -1 || echo unknown)"

# ---------------------------------------------------------------------------
# Link to a project+service (required for `railway up`).
# ---------------------------------------------------------------------------
# `railway status` fails when not linked.
if ! railway status >/dev/null 2>&1; then
    if [ "$MODE_INIT" -eq 1 ]; then
        info "This repo is not linked to a Railway project."
        printf "${BOLD}Options:${RESET}\n  1) Link an existing project\n  2) Create a new project\n"
        read -r -p "Pick [1/2]: " choice
        case "${choice:-1}" in
            2)
                read -r -p "New project name: " proj_name
                railway init --name "${proj_name:-data-talks}"
                ;;
            *)
                railway link
                ;;
        esac

        info "Do you want to provision a Postgres add-on? (Data Talks defaults to SQLite but Railway storage is ephemeral — Postgres is strongly recommended.)"
        read -r -p "Add Postgres? [Y/n]: " add_pg
        if [ "${add_pg:-Y}" != "n" ] && [ "${add_pg:-Y}" != "N" ]; then
            railway add --database postgres || warn "Postgres provisioning failed or already exists — continuing."
            info "After provisioning, set DATABASE_URL on the service:"
            printf "    ${DIM}railway variables --set 'DATABASE_URL=\${{Postgres.DATABASE_URL}}'${RESET}\n"
        fi
    else
        fail "This directory is not linked to a Railway project. Run: scripts/deploy-railway.sh --init"
        exit 1
    fi
fi

STATUS_JSON="$(railway status --json 2>/dev/null || true)"
if [ -n "$STATUS_JSON" ]; then
    project_name="$(printf '%s' "$STATUS_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("projectName") or d.get("project",{}).get("name",""))' 2>/dev/null || true)"
    env_name="$(printf '%s' "$STATUS_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("environmentName") or d.get("environment",{}).get("name",""))' 2>/dev/null || true)"
    svc_name="$(printf '%s' "$STATUS_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("serviceName") or d.get("service",{}).get("name",""))' 2>/dev/null || true)"
    ok "Linked to project: ${project_name:-?} / env: ${env_name:-?} / service: ${svc_name:-?}"
fi

# ---------------------------------------------------------------------------
# Optional: sync backend/.env to Railway variables.
# ---------------------------------------------------------------------------
if [ "$MODE_SYNC_ENV" -eq 1 ]; then
    ENV_FILE="backend/.env"
    [ -f "$ENV_FILE" ] || die "No $ENV_FILE to sync. Create one from backend/.env.example first."

    info "Reading variables from $ENV_FILE..."
    declare -a kv_args=()
    count=0
    while IFS= read -r line || [ -n "$line" ]; do
        # Strip leading whitespace, skip blanks and comments.
        trimmed="${line#"${line%%[![:space:]]*}"}"
        [ -z "$trimmed" ] && continue
        [[ "$trimmed" == \#* ]] && continue
        # Expect KEY=VALUE
        [[ "$trimmed" != *"="* ]] && continue
        key="${trimmed%%=*}"
        value="${trimmed#*=}"
        # Strip matching surrounding quotes from the value.
        if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
        if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
        # Skip empty values — they'd just clobber anything already set on Railway.
        [ -z "$value" ] && continue
        kv_args+=(--set "${key}=${value}")
        count=$((count + 1))
    done < "$ENV_FILE"

    if [ "$count" -eq 0 ]; then
        warn "No non-empty variables found in $ENV_FILE — nothing to sync."
    else
        warn "About to upload ${count} variable(s) to Railway (values are NOT printed)."
        read -r -p "Proceed? [y/N]: " confirm
        if [ "${confirm:-N}" = "y" ] || [ "${confirm:-N}" = "Y" ]; then
            railway variables "${kv_args[@]}"
            ok "Variables synced."
        else
            warn "Sync cancelled."
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Sanity check: verify required files exist before pushing.
# ---------------------------------------------------------------------------
[ -f "Dockerfile" ] || die "Dockerfile missing at repo root."
[ -f "railway.toml" ] || warn "railway.toml missing — Railway will use defaults, which may not set healthcheck/restart policy."

# ---------------------------------------------------------------------------
# Deploy.
# ---------------------------------------------------------------------------
info "Starting deploy (railway up)..."
# --detach so the script doesn't block on the full build; user can tail with --logs.
railway up --ci --detach
ok "Deploy triggered."

# ---------------------------------------------------------------------------
# Optional: tail logs.
# ---------------------------------------------------------------------------
if [ "$MODE_LOGS" -eq 1 ]; then
    info "Tailing deploy logs (Ctrl+C to stop; the deploy continues in the background)..."
    # --deployment tails the most recent deploy; works on CLI v3.
    railway logs --deployment || railway logs
fi

ok "Done."
cat <<EOF

${BOLD}Next steps:${RESET}
  - Open the service URL:       ${DIM}railway open${RESET}
  - Tail runtime logs:          ${DIM}railway logs${RESET}
  - Re-deploy after code edits: ${DIM}scripts/deploy-railway.sh${RESET}
  - Add/update a single var:    ${DIM}railway variables --set KEY=VALUE${RESET}

EOF
