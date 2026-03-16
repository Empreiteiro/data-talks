.PHONY: help install install-frontend install-backend install-cli \
        build run dev migrate setup-env lint test

# Default target
help:
	@echo "Data Talks - Available commands:"
	@echo ""
	@echo "  make install           Install frontend and backend dependencies"
	@echo "  make install-frontend  Install frontend (npm) dependencies"
	@echo "  make install-backend   Install backend (uv) dependencies"
	@echo "  make install-cli       Install the data-talks CLI via uv"
	@echo "  make build             Build frontend for production"
	@echo "  make run               Build frontend and start backend (http://localhost:8000)"
	@echo "  make dev               Start backend + frontend dev server with hot reload"
	@echo "  make migrate           Run database migrations"
	@echo "  make setup-env         Copy backend/.env.example to backend/.env (if not exists)"
	@echo "  make lint              Run frontend linter"
	@echo "  make test              Run frontend tests"

# ------------------------------------------------------------------
# Install
# ------------------------------------------------------------------

install: install-frontend install-backend

install-frontend:
	npm install

install-backend:
	uv pip install -e ./backend

install-cli:
	uv pip install -e ./backend

# ------------------------------------------------------------------
# Build & Run
# ------------------------------------------------------------------

build:
	npm run build

run: build setup-env
	uv run data-talks run

dev: setup-env
	@echo "Starting backend and frontend dev server..."
	@uv run data-talks run &
	@VITE_API_URL=http://localhost:8000 npm run dev

# ------------------------------------------------------------------
# Database
# ------------------------------------------------------------------

migrate: setup-env
	cd backend && uv run alembic upgrade head

# ------------------------------------------------------------------
# Utilities
# ------------------------------------------------------------------

setup-env:
	@if [ ! -f backend/.env ]; then \
		cp backend/.env.example backend/.env; \
		echo "Created backend/.env from .env.example — edit it to add your API keys."; \
	fi

lint:
	npm run lint

test:
	npm test
