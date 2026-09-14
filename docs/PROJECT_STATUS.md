# Estado del proyecto YIBO

Este archivo es la fuente de verdad viva del avance. Los documentos `BASELINE_*`
son históricos y los ADR registran decisiones; ninguno sustituye este tablero.

## Punto verificado

- Fecha: 10 de septiembre de 2026.
- Rama y commit inicial: `main` en `7df03e4`.
- Estado inicial: árbol limpio y sincronizado con `origin/main`.
- Validación inicial: `pnpm typecheck` aprobado; 146 pruebas aprobadas y 1 omitida.
- Checkpoint activo: **Checkpoint 5 — Esquema avanzado del agente y Realtime**.
- Tarea activa: **AGENT-007 — paralelismo sólo con herramientas de lectura**.
- Último checkpoint cerrado: Checkpoint 4; `pnpm typecheck`, 215 pruebas
  aprobadas, 1 omitida y `pnpm build` aprobados.
- Última tarea verificada: AGENT-004; `pnpm typecheck`, 223 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Última tarea verificada: AGENT-005; `pnpm typecheck`, 227 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Última tarea verificada: AGENT-006; `pnpm typecheck`, 235 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.

## Capacidades existentes

- Runtime OpenAI Realtime speech-to-speech y runtime en memoria.
- Configuración de agente persistida por tenant y laboratorio de voz.
- Herramientas para disponibilidad, contacto, creación, cancelación y
  reprogramación de citas, transferencia y pruebas locales autorizadas.
- Google Calendar con OAuth, FreeBusy y creación/cancelación de eventos.
- API Fastify, dashboard Vue, persistencia SQLite regional y gateway Asterisk.

## Brechas conocidas al iniciar

- El dashboard no reconoce `update_customer`, aunque el backend lo publica.
- Arquitectura y guía de construcción describen una versión anterior del repo.
- La autenticación y los roles ya cubren la API; falta persistir auditoría redactada.
- El negocio sólo puede editar la zona horaria desde el dashboard.
- No existe todavía el modelo multi-sucursal ni el calendario por profesional.
- Parte importante de la política conversacional está codificada en el adaptador.
- La transferencia existe como contrato, pero no está cableada a telefonía.

## Convención de avance

Estados permitidos: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`.

Una tarea sólo cambia a `DONE` cuando su implementación, pruebas y documentación
están en el mismo commit. Cada tarea debe ser reversible, mantener el typecheck y
ejecutar al menos su subconjunto relevante de pruebas. Cada checkpoint termina
con `pnpm test` y `pnpm build`.

## Roadmap

| ID | Estado | Resultado |
|---|---|---|
| DOC-001 | DONE | Estado maestro, índice ADR e inventario de decisiones |
| DOC-002 | DONE | Arquitectura, capacidades y guía alineadas con el código actual |
| FIX-001 | DONE | Descriptores completos de tools y dashboard tolerante a extensiones |
| FIX-002 | DONE | API prueba nombres y metadata que consume dinámicamente el dashboard |
| FIX-003 | DONE | Fábrica única versionada; bootstrap y runtime consumen configuración resuelta |
| AUTH-001 | DONE | ADR-002 y contratos neutrales de principal, sesión y roles |
| AUTH-002 | DONE | Usuarios SQLite, scrypt y comando interactivo `admin:create` |
| AUTH-003 | DONE | Login/logout/me y sesión HMAC HttpOnly de ocho horas |
| AUTH-004 | DONE | Guard central, Origin explícito y rechazo recursivo de tenant/region |
| AUTH-005 | DONE | Configuración y administración sólo para tenant_admin; operación para operator |
| AUD-001 | DONE | Sujeto, entidad, versión y diff redactado persistidos por tenant |
| LOC-001 | DONE | ADR-003, LocationId, catálogos, sucursales, asignaciones y validación |
| LOC-002 | DONE | Entrada v1 explícita y upgrader puro/idempotente a sucursal default v2 |
| LOC-003 | DONE | Migración v7 idempotente; backfill default sin pérdida en números, llamadas y citas |
| LOC-004 | DONE | DID resuelve tenant/location y ambos se propagan sin aceptar IDs del modelo |
| LOC-005 | DONE | Fixtures MX/US y persistencia en memoria usan exclusivamente v2 canónica |
| LOC-006 | DONE | GET/PUT admin, If-Match, CAS SQLite/memoria, 409 y auditoría versionada |
| CAT-001 | DONE | CRUD admin versionado, validación, auditoría y protección de referencias |
| CAT-002 | DONE | CRUD de profesionales/asignaciones, horario y bloqueo de referencias usadas |
| PRICE-001 | DONE | Money en unidades menores, moneda ISO 4217 y upgrade v2 transitorio |
| PRICE-002 | DONE | Citas congelan nombre/precio; migración v9 rellena registros existentes |
| SCHED-001 | DONE | Intersección por intervalos; horario vacío del profesional hereda sucursal |
| SCHED-002 | DONE | Cierres locales bloquean slots; el motivo queda sólo en administración |
| SCHED-003 | DONE | API versionada y validación completa de política por sucursal |
| SCHED-004 | DONE | Grid, lead time, horizonte, límites y avisos aplicados en dominio |
| SCHED-005 | DONE | Capacidad profesional 1, límite de sucursal y guard location-wide |
| CAL-001 | DONE | Resolver confiable reemplaza calendarId global en todas las operaciones Google |
| CAL-002 | DONE | API versionada: default de sucursal, override profesional y fallback explícito |
| CAL-003 | DONE | OAuth cifrado por tenant valida acceso antes de activar y publica estado seguro |
| CAL-004 | DONE | FreeBusy/create/cancel resuelven asignación y registran sólo metadata segura |
| TRANSFER-001 | DONE | Destino phone/extension validado, normalizado y versionado por sucursal |
| TRANSFER-002 | DONE | HumanTransfer usa telefonía, estados persistidos y compensación a conversación |
| AGENT-001 | DONE | ADR-004, schemaVersion y upgrade automático conservador en memoria/SQLite |
| AGENT-002 | DONE | Prompt compone guía editable, contexto confiable y reglas inmutables |
| AGENT-003 | DONE | API, backend y panel consumen un registro único y rechazan combinaciones incompatibles |
| AGENT-004 | DONE | Esquema v2, audio/VAD, inactividad, tracing y truncación validados por modelo |
| AGENT-005 | DONE | Saludo, estilo, silencios, slots y orden de datos estructurados en schema v3 |
| AGENT-006 | DONE | Canal confiable, tool_choice, límites, reintentos y transferencia automática en schema v4 |
| AGENT-007 | IN_PROGRESS | Paralelismo permitido sólo para tools de lectura |
| AGENT-008 | TODO | Invariantes de transporte PCM/modalidad documentadas |
| AGENT-009 | TODO | Payload Realtime validado y probado por modelo |
| TOOL-001 | TODO | Información segura de servicios y precios |
| TOOL-002 | TODO | Listado de próximas citas del cliente |
| TOOL-003 | TODO | Cancelación/reprogramación sin IDs expuestos |
| TOOL-004 | TODO | ConfirmationGate ligado a acción y turno |
| TOOL-005 | TODO | Confirmación expirable y de un solo uso |
| TOOL-006 | TODO | Límites de tools y escalamiento seguro |
| TOOL-007 | TODO | Descriptores e instrucciones de capacidades completas |
| TOOL-008 | TODO | Aislamiento permanente de herramientas de prueba |
| UI-001 | TODO | Shell de autenticación y permisos |
| UI-002 | TODO | Panel generado desde capacidades del modelo |
| UI-003 | TODO | Edición de comportamiento, tools y escalamiento |
| UI-004 | TODO | Preview real y explícita mediante Voice Lab |
| UI-005 | TODO | Administración de sucursales y políticas |
| UI-006 | TODO | Administración de catálogos, precios y profesionales |
| UI-007 | TODO | Mapeo de calendarios |
| UI-008 | TODO | Operación ampliada de citas |
| UI-009 | TODO | Edición optimista y conflictos explícitos |
| OBS-001 | TODO | Observabilidad correlacionada sin PII |
| SEC-001 | TODO | Pruebas de aislamiento y entradas hostiles |
| E2E-001 | TODO | Flujo completo de voz hasta Google Calendar |
| E2E-002 | TODO | Fallos, cambios de cita y transferencia end-to-end |
| DOC-003 | TODO | Diagramas y runbooks finales |
| REL-001 | TODO | Ensayo de migración regional y validación completa |
| REL-002 | TODO | Cierre del roadmap sin contradicciones ni deuda declarada |

## Registro de decisiones

### Vigentes antes de este roadmap

- Monolito modular con puertos y adaptadores.
- Una sesión de conversación por llamada (`ADR-001`).
- La IA solicita; el dominio valida y ejecuta.
- `tenantId`, `locationId`, `callId` y `customerId` son contexto confiable.
- Scheduling consulta y Appointments muta y revalida.
- Instantes internos en UTC y presentación en zona IANA del negocio.
- No se persisten audio ni transcripciones.

### Aceptadas para el roadmap

- Fundamentos y autorización antes de ampliar las pantallas de mutación.
- Roadmap vivo más ADRs inmutables para decisiones arquitectónicas.
- Sólo controles confirmados para cada modelo; no se acepta JSON libre.
- Sesión administrativa firmada con roles `tenant_admin` y `operator`.
- Catálogos tenant-wide y asignaciones específicas por sucursal.
- El número marcado determina una única sucursal; el modelo no la cambia.
- Calendario por profesional con fallback de sucursal.
- Precio informativo congelado en la cita; no se implementan pagos.
- Los perfiles existentes migran automáticamente a una sucursal default.

Las formas finales de estos contratos se registrarán en sus ADR antes de la
primera implementación que dependa de ellos.
