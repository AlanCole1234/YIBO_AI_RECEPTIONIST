# YIBO

Núcleo de una recepcionista telefónica con IA, multi-tenant, construido como
monolito modular. La aplicación local expone los módulos mediante una API
Fastify y un dashboard Vue.

Roadmap de software cerrado hasta REL-002; aceptación live y preparación del
despliegue siguen pendientes del operador. Ver la auditoría antes de desplegar.

## Documentación

- [Auditoría de cierre y pendientes](docs/RELEASE_CLOSURE_AUDIT.md)
- [Estado y roadmap](docs/PROJECT_STATUS.md)
- [Arquitectura actual](docs/ARCHITECTURE.md)
- [Guía para seguir construyendo](docs/BUILDING_GUIDE.md)
- [Decisiones arquitectónicas](docs/adr/README.md)
- [Operación, administración y diagnóstico](docs/OPERATIONS_RUNBOOK.md)
- [Operación diaria de oficina](docs/BUSINESS_OPERATIONS.md)
- [Matriz de brechas de configuración](docs/CONFIGURATION_GAP_MATRIX.md)
- [Catálogo de configuración](docs/CONFIGURATION_CATALOG.md)
- [Migración y recuperación](docs/MIGRATION_RECOVERY.md)
- [Contrato histórico de arquitectura](YIBO_ARCHITECTURE_AND_CODEX_CONTRACTS.md)

## Run locally

```sh
pnpm install
pnpm db:init
pnpm admin:create --tenant tenant-yibo-demo --region MX --email admin@example.com
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

The current entry points select a bootstrap tenant using server-owned `YIBO_TENANT_ID`; its catalog profile determines the regional database. `YIBO_REGION` does not switch the current API/Voice Lab process independently. Administrative sessions must match the application tenant; phone calls resolve tenant/location from the dialed number. Browser/model arguments cannot choose this trusted scope.

## Local database model

Isolation is enforced at two levels: MX and US use different database files, and every operational primary/foreign key is scoped by `region_id` plus `tenant_id`. Customers, appointments, and calendar events therefore cannot be joined across a region or tenant accidentally.

Schema migrations 1–10: `src/infrastructure/database/migrations/`. See the recovery runbook before starting a newer build against existing data.

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

Automated E2E coverage uses simulated providers and local RTP. The local-copy REL-001 migration rehearsal passed; live phone/provider acceptance
remains outstanding. See project status and the migration rehearsal report.
