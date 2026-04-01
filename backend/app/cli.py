"""
CLI for data-talks: run server, run migrations.
Usage: data-talks run | data-talks migrate
"""
import argparse
import socket
import sys
import os


def _is_port_available(host: str, port: int) -> bool:
    """Check if a port is available for binding."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0" if host == "::" else host, port))
            return True
        except OSError:
            return False


def _find_available_port(host: str, start_port: int, max_attempts: int = 10) -> int:
    """Find the next available port starting from start_port."""
    for offset in range(max_attempts):
        port = start_port + offset
        if _is_port_available(host, port):
            return port
    raise RuntimeError(f"No available port found in range {start_port}-{start_port + max_attempts - 1}")


def _run_server(host: str = "0.0.0.0", port: int = 8000) -> None:
    import uvicorn
    # Run from backend dir so app is importable and .env is found
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(backend_dir)
    sys.path.insert(0, backend_dir)

    if not _is_port_available(host, port):
        original_port = port
        port = _find_available_port(host, port + 1)
        print(f"⚠️  Port {original_port} is in use. Starting on port {port} instead.")

    # Write the resolved port to a temp file so other tools (Makefile, frontend) can read it
    port_file = os.path.join(backend_dir, ".backend_port")
    with open(port_file, "w") as f:
        f.write(str(port))

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=True,
    )


def _run_migrate() -> None:
    import subprocess
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(backend_dir)
    sys.path.insert(0, backend_dir)
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(prog="data-talks", description="Data Talks backend")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run the API server (uvicorn)")
    run_parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    run_parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")

    subparsers.add_parser("migrate", help="Run Alembic migrations (upgrade head)")

    args = parser.parse_args()

    if args.command == "run":
        _run_server(host=args.host, port=args.port)
    elif args.command == "migrate":
        _run_migrate()
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
