# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Stage 1: build the Vite frontend into dist/
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /build

# Install deps first for better layer caching.
COPY package.json package-lock.json* bun.lockb* ./
RUN npm ci --no-audit --no-fund

# Copy the sources that participate in the bundle.
COPY index.html vite.config.ts tsconfig*.json tailwind.config.ts postcss.config.js \
     components.json eslint.config.js ./
COPY public ./public
COPY src ./src

RUN npm run build


# ---------------------------------------------------------------------------
# Stage 2: Python runtime. Backend + built frontend served as static files.
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS runtime

# System deps for asyncpg/psycopg2 and image rendering (matplotlib cairo).
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      libpq-dev \
      && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager used by this project).
ADD https://astral.sh/uv/install.sh /tmp/uv-install.sh
RUN sh /tmp/uv-install.sh && rm /tmp/uv-install.sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

# Install backend deps first so they're cached independently of source changes.
COPY backend/pyproject.toml backend/README.md ./backend/
RUN uv pip install --system --no-cache -e ./backend

# Now bring in the rest of the backend source.
COPY backend ./backend

# Built frontend assets — served by FastAPI as static files in production mode.
COPY --from=frontend-builder /build/dist ./dist

# Railway injects $PORT at runtime; fall back to 8000 locally.
ENV PORT=8000
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# Entrypoint: run migrations, then launch uvicorn on $PORT without reload.
# Using sh -c to expand $PORT; exec so uvicorn becomes PID 1 and receives signals.
CMD ["sh", "-c", "cd backend && uv run alembic upgrade head && exec uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
