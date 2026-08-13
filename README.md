# YIBO

Local development shell for the YIBO modular monolith. It composes the current
business, customer, scheduling, appointment, and integration modules behind a
Fastify API and a Vue dashboard.

## Run locally

```sh
pnpm install
pnpm db:init
pnpm dev
```

`db:init` is idempotent: it creates or migrates both regional SQLite databases and seeds their local demo tenant. Run it after cloning and whenever migrations are added.

- Mexico database: `data/yibo-mx.sqlite`
- United States database: `data/yibo-us.sqlite`

Node.js 22.5 or newer is required because the local adapter uses the built-in SQLite module. Database files are local runtime data and are intentionally ignored by Git; the schema and seed definitions are committed.

The default development context is Mexico. To run the US tenant in PowerShell:

```powershell
$env:YIBO_REGION="US"
$env:YIBO_TENANT_ID="tenant-yibo-demo-us"
pnpm dev
```

To return to Mexico:

```powershell
$env:YIBO_REGION="MX"
$env:YIBO_TENANT_ID="tenant-yibo-demo"
pnpm dev
```

In production these values must come from authenticated, server-validated session claims. A browser or AI model must never be allowed to choose an arbitrary tenant or region.

## Local database model

Isolation is enforced at two levels: MX and US use different database files, and every operational primary/foreign key is scoped by `region_id` plus `tenant_id`. Customers, appointments, and calendar events therefore cannot be joined across a region or tenant accidentally.

Schema migration: `src/infrastructure/database/migrations/001_initial.sql`

Regional configuration example: `.env.example`

- Dashboard: `http://localhost:5173`
- API: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
```
