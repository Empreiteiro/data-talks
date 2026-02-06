"""
CLI for data-talks: run server, run migrations.
Usage: data-talks run | data-talks migrate
"""
import argparse
import sys
import os


def _run_server(host: str = "0.0.0.0", port: int = 8000) -> None:
    import uvicorn
    # Run from backend dir so app is importable and .env is found
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(backend_dir)
    sys.path.insert(0, backend_dir)
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
