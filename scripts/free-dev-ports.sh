#!/usr/bin/env bash
# Free the ports the dev stack uses, but only kill our own processes.
#
# Why we need this: the backend CLI (`data-talks run`) writes the port it
# bound to into `backend/.backend_port`. If a previous session left a zombie
# uvicorn on :8000 — or a previous run let the CLI fall back to :8001 — the
# `.backend_port` file ends up stale and Vite picks the wrong upstream.
# The blast radius is wide ("CORS broken", "frontend hits dead port",
# "summary 500", and so on), so the safest fix is to nuke our own dev
# processes on those ports before each `make dev`.
#
# Safety:
#   - We only kill processes whose command line includes one of:
#       uvicorn   |   data-talks   |   vite
#     Anything else listening on the same port (Firestore emulator,
#     Tomcat, whatever) is left alone — those are not us.
#   - The script is silent on success and prints what it killed when it
#     does kill something, so `make dev` output is readable.

set -e

PORTS_BACKEND=(8000 8001 8002 8003 8004 8005)
PORTS_FRONTEND=(5173)
ALL_PORTS=("${PORTS_BACKEND[@]}" "${PORTS_FRONTEND[@]}")

# `lsof -ti:PORT` returns one PID per line for IPv4 listeners. We then check
# /proc-style command listings via `ps` to confirm it's our process before
# killing. The patterns below are deliberately narrow — earlier versions
# matched any command containing "data-talks", which would also fire on
# unrelated processes that just happened to live under the data-talks repo
# (VS Code language servers, file watchers, etc).
_is_our_process() {
    local pid="$1"
    local cmd
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    [[ -z "$cmd" ]] && return 1
    case "$cmd" in
        # Backend: the CLI launcher and the uvicorn worker it spawns.
        *"data-talks run"*) return 0 ;;
        *"data-talks/backend"*"app.main"*) return 0 ;;
        *uvicorn*"app.main"*) return 0 ;;
        # uv-spawned Python that owns the .venv inside this repo.
        *"data-talks/.venv/bin/python"*"data-talks/backend"*) return 0 ;;
        *"data-talks/.venv/bin/python"*"--multiprocessing-fork"*) return 0 ;;
        # Frontend: Vite invoked from this repo's node_modules. We match
        # the Vite binary path, not just "vite", to avoid Vitest workers
        # or other tools whose argv contain the word.
        *"data-talks/node_modules/.bin/vite"*) return 0 ;;
        *"data-talks/node_modules/vite/"*"vite.js"*) return 0 ;;
    esac
    return 1
}

kills=0
for port in "${ALL_PORTS[@]}"; do
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    [[ -z "$pids" ]] && continue
    while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        if _is_our_process "$pid"; then
            cmd=$(ps -p "$pid" -o command= 2>/dev/null | head -c 80)
            printf "  killing PID %s on :%s — %s\n" "$pid" "$port" "$cmd"
            kill "$pid" 2>/dev/null || true
            kills=$((kills + 1))
        fi
    done <<< "$pids"
done

# Stale port file from a previous run can fool Vite proxy resolution.
# Always clear it; the CLI will rewrite it on next start.
if [[ -f backend/.backend_port ]]; then
    rm -f backend/.backend_port
fi

# Give the OS a beat to release the sockets before the next process binds.
if [[ $kills -gt 0 ]]; then
    echo "  freed $kills process(es); waiting 1s for sockets to close..."
    sleep 1
fi

exit 0
