# YIBO

Local development shell for the YIBO modular monolith. It composes the current
business, customer, scheduling, appointment, and integration modules behind a
Fastify API and a Vue dashboard.

## Run locally

```sh
pnpm install
pnpm dev
```

- Dashboard: `http://localhost:5173`
- API: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
```
