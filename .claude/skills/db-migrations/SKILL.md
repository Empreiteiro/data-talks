---
name: db-migrations
description: How to add tables, columns and data migrations in Data Talks so they work on both SQLite (default) and PostgreSQL — Alembic conventions, idempotent inspector-guarded ops, the _ensure_* startup helpers, dialect-portable defaults and types, JSON-column mutation, encrypted columns. Use when editing backend/app/models.py, adding a file under backend/alembic/versions/, touching main.py startup DDL, or debugging a migration that works on SQLite but fails on PostgreSQL.
---

# Database migrations (SQLite + PostgreSQL)

The app runs on SQLite by default and PostgreSQL via `DATABASE_URL`. CI only runs SQLite with `create_all`, so
PostgreSQL bugs have reached deploys (89163a6, b72ddf3). Treat both dialects as targets on every schema change.

## How schema changes reach a database today

1. **Alembic** — `backend/alembic/versions/`. `env.py` converts the async URL to a sync one
   (`sqlite+aiosqlite` → `sqlite`, `postgresql+asyncpg` → `postgresql+psycopg2`). Run with
   `cd backend && uv run alembic upgrade head` (or `make migrate`).
2. **`Base.metadata.create_all`** — runs in the `lifespan` of `app/main.py` on **every boot**, creating any missing
   table straight from `models.py`.
3. **`_ensure_*` helpers in `main.py`** — raw `ALTER TABLE … ADD COLUMN` for columns added before migrations were
   reliable (`_ensure_alert_system_columns`, `_ensure_claude_code_columns`, …). Do not add new ones; write a
   migration.

Because (2) may have created the table already, **every migration must be idempotent**.

## Writing a migration

- File name `YYYYMMDDHHMMSS_short_description.py`; `revision = "<that timestamp>"`;
  `down_revision` = the previous head (check `ls backend/alembic/versions | sort | tail`; there is one merge
  revision with a tuple `down_revision`).
- Start from autogenerate, then edit: `cd backend && uv run alembic revision --autogenerate -m "description"`.
- Guard every op with the inspector:
  ```python
  bind = op.get_bind()
  insp = sa.inspect(bind)
  if "source_groups" in set(insp.get_table_names()):
      return
  cols = {c["name"] for c in insp.get_columns("agents")}
  if "sql_mode" not in cols:
      with op.batch_alter_table("agents") as batch:          # SQLite needs batch mode for ALTERs
          batch.add_column(sa.Column("sql_mode", sa.Boolean(), nullable=False, server_default=sa.false()))
  ```
- IDs are `sa.String(36)` UUIDs generated in Python; tenant tables carry `organization_id String(36)` with an index.
- Keep `models.py` and the migration in sync: same nullability, same unique constraints (a constraint only in the
  migration is missing from `create_all` test databases, e.g. `PipelineVersion`'s unique triple).

## Portability rules (learned the hard way)

| Do | Don't | Why |
|---|---|---|
| `server_default=sa.false()` / `sa.true()` on Boolean | `sa.text("0")` / `sa.text("1")` | PostgreSQL: "column is of type boolean but default expression is of type integer" (89163a6). Integer columns may keep `sa.text("0")`. |
| `BOOLEAN DEFAULT false`, `TIMESTAMP` in raw DDL | `DEFAULT 0`, `DATETIME` | PostgreSQL has no `DATETIME`; both spellings work on SQLite (b72ddf3). |
| Declare unique constraints inline in `op.create_table` | Standalone `op.create_unique_constraint` | SQLite cannot ALTER constraints in (7ccf376). |
| Copy rows out, recreate, copy back to change a PK on SQLite | `ALTER` the primary key | SQLite cannot alter a PK in place (7ccf376 rebuilt `github_connections`). |
| Generate ids/values in Python and bind them | `randomblob()`, `hex()`, other dialect functions | `lower(hex(randomblob(16)))` is SQLite-only. |
| Enforce `NOT NULL` in the migration after backfilling | Leave the column nullable "for now" | Schema then differs between Alembic-built and `create_all`-built databases. |
| Size `VARCHAR` for ciphertext, or use `Text` | `String(256)` for a value that will be Fernet-encrypted | Fernet output is ~1.4× + overhead; PostgreSQL enforces lengths, SQLite does not. |

## Data migrations

- Read JSON defensively: SQLite returns JSON columns as `str`, PostgreSQL as `dict`
  (`json.loads` when it is a string).
- Make them idempotent and re-runnable. Model: `20260413130000_encrypt_existing_secrets.py` — skips values that
  already look encrypted (`gAAAA…` or `{"__enc": …}`), keeps its own frozen copy of the key list, imports app code
  lazily inside `upgrade()`, and documents downgrade as a no-op ("restore from backup").
- Backfills only see rows that exist at migration time. Anything the app seeds later (guest user, default org)
  must also be created idempotently by the seeder (70a330f: fresh installs had a guest user with no membership).

## JSON columns in the ORM

`metadata_`, `workspace_config`, `source_ids` are plain `JSON` columns without mutation tracking. Mutating the
loaded dict/list in place and assigning the same object back may not be flushed. Always copy, then assign:

```python
config = dict(agent.workspace_config or {})
pipelines = list(config.get("pipelines") or [])
pipelines.append(new_pipeline)
config["pipelines"] = pipelines
agent.workspace_config = config          # new object → change detected
```

or call `sqlalchemy.orm.attributes.flag_modified(agent, "workspace_config")`. JSON equality is not portable in SQL
either — compare JSON sets in Python (see `_get_or_create_group` in `onboarding_router.py`).

## Long transactions

Never hold an app-DB write transaction across an LLM or warehouse call: `record_log` writes through its own
session, and on SQLite the second writer gets "database is locked" (b469ae0). Avoid eager `flush()` before slow
calls; assign ids client-side with `uuid.uuid4()`.

## Known pitfalls in the current code

- `20260414120000_add_org_id_to_remaining_models.py` backfills with `randomblob` (fails on PostgreSQL if orphan rows
  exist) and leaves `organization_id` nullable while the models declare NOT NULL.
- `telegram_bot_configs` and `whatsapp_bot_configs` have no create-table migration; they exist only via
  `create_all`.
- `_ensure_claude_code_columns` adds `VARCHAR(512)` while the model uses `EncryptedText` (Text) — types drift by
  environment.
- CI never runs `alembic upgrade head` and has no PostgreSQL service.

## Checks before you finish

- Fresh SQLite: `cd backend && rm -f /tmp/mig.db && DATABASE_URL=sqlite+aiosqlite:////tmp/mig.db uv run alembic upgrade head`
- Re-run it on the same file (idempotency) and once after starting the app (`create_all` first, then upgrade).
- PostgreSQL when available, e.g. `docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=pg postgres:16` then
  `DATABASE_URL=postgresql+asyncpg://postgres:pg@localhost:5433/postgres uv run alembic upgrade head`.
- Without a server, compile the DDL for both dialects:
  ```python
  from sqlalchemy.schema import CreateTable
  from sqlalchemy.dialects import postgresql, sqlite
  print(CreateTable(Model.__table__).compile(dialect=postgresql.dialect()))
  print(CreateTable(Model.__table__).compile(dialect=sqlite.dialect()))
  ```
- `cd backend && pytest -q`

General version: `data-analytics:sqlite-postgres-portability` in https://github.com/Empreiteiro/skills
