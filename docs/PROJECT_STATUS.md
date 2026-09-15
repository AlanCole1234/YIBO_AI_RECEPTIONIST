# Estado del proyecto YIBO

Este archivo es la fuente de verdad viva del avance. Los documentos `BASELINE_*`
son históricos y los ADR registran decisiones; ninguno sustituye este tablero.

## Punto verificado

- Fecha: 10 de septiembre de 2026.
- Rama y commit inicial: `main` en `7df03e4`.
- Estado inicial: árbol limpio y sincronizado con `origin/main`.
- Validación inicial: `pnpm typecheck` aprobado; 146 pruebas aprobadas y 1 omitida.
- Checkpoint activo: **Checkpoint 7 — Paneles administrativos**.
- Validación de integración: 306 pruebas aprobadas, 1 live omitida; ambos typechecks y build aprobados; reprogramación conserva el ID Google con etag y ownership.
- Tarea activa: **ninguna — UI-005 terminada; ejecución detenida por solicitud del usuario**.
- Próxima tarea: **UI-006**, pendiente y no iniciada.
- UI-005 verificada el 15 de septiembre de 2026: 24 pruebas focales aprobadas, ambos typechecks y build de producción aprobados.
- Baseline recuperado verificado localmente: 270 pruebas aprobadas, 1 omitida; ambos typechecks y build aprobados el 15 de septiembre de 2026.
- Preservación local completa: `backup/alan-local-before-integration` (`54e4b9b`), backup remoto de `edd624e`, bundle privado verificado para ambos stashes y reflog. Ver `INTEGRATION_INVENTORY.md`.
- Último checkpoint cerrado: Checkpoint 6; 261 pruebas aprobadas, 1 omitida y
  `pnpm build` aprobado el 14 de septiembre de 2026.
- Última tarea verificada: AGENT-004; `pnpm typecheck`, 223 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Última tarea verificada: AGENT-005; `pnpm typecheck`, 227 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Última tarea verificada: AGENT-006; `pnpm typecheck`, 235 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Última tarea verificada: AGENT-007; `pnpm typecheck`, 237 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Última tarea verificada: AGENT-008; `pnpm typecheck` y pruebas focales de
  agente, conversación, Realtime y PCM aprobadas el 14 de septiembre de 2026.
- Última tarea verificada: AGENT-009; payloads de ambos modelos y rechazo previo
  a conexión aprobados; suite completa 243/243, 1 omitida y build aprobados el
  14 de septiembre de 2026.
- Última tarea verificada: TOOL-001; `pnpm typecheck` y 43 pruebas focales de
  tools, configuración, API, bootstrap y SQLite aprobadas el 14 de septiembre
  de 2026.
- Última tarea verificada: TOOL-002; `pnpm typecheck` y 55 pruebas focales de
  dominio, tools, configuración, API y SQLite aprobadas el 14 de septiembre de
  2026.
- Última tarea verificada: TOOL-003; `pnpm typecheck` y 37 pruebas focales de
  tools, definición, API y payload Realtime aprobadas el 14 de septiembre de
  2026.
- Última tarea verificada: TOOL-004; `pnpm typecheck` y 38 pruebas focales de
  configuración, gate, secuencia de conversación y políticas aprobadas el 14 de
  septiembre de 2026.
- Última tarea verificada: TOOL-005; `pnpm typecheck` y 30 pruebas focales de
  expiración, turno nuevo, replay, fallos y conversación aprobadas el 14 de
  septiembre de 2026.
- Última tarea verificada: TOOL-006; `pnpm typecheck` y 34 pruebas focales de
  límites, excepciones, confirmación y conversación aprobadas el 14 de septiembre
  de 2026.
- Última tarea verificada: TOOL-007; `pnpm typecheck` y 40 pruebas focales de
  prompt, tools, API, modo de prueba y flujo E2E en memoria aprobadas el 14 de
  septiembre de 2026.
- Última tarea verificada: TOOL-008; 53 pruebas focales aprobadas; suite completa
  261/261, 1 omitida y build aprobados el 14 de septiembre de 2026.
- Última tarea verificada: UI-001; `pnpm typecheck`, 10 pruebas focales de sesión,
  API y roles, y `pnpm build` aprobados el 14 de septiembre de 2026.
- Última tarea verificada: UI-002; `pnpm typecheck`, 8 pruebas focales de registro
  y API, y `pnpm build` aprobados el 14 de septiembre de 2026.
- Última tarea verificada: UI-003; `pnpm typecheck`, 21 pruebas focales de panel,
  políticas, configuración y API, y `pnpm build` aprobados el 14 de septiembre
  de 2026.

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
| AGENT-007 | DONE | Paralelismo por canal rechazado ante cualquier tool mutable o externa |
| AGENT-008 | DONE | Canal confiable fuerza audio; PCM16 mono 24 kHz vive en una constante compartida |
| AGENT-009 | DONE | Constructor único valida capacidades; contratos completos fijados para ambos modelos |
| TOOL-001 | DONE | Consulta pública tenant-scoped de servicios, precios localizados y sucursales sin IDs |
| TOOL-002 | DONE | Consulta tenant/customer/location-scoped con referencias efímeras y snapshots históricos |
| TOOL-003 | DONE | Mutaciones aceptan sólo referencias efímeras same-call y no devuelven IDs internos |
| TOOL-004 | DONE | ADR-007, política mutable y token opaco ligado a call/tool/args/turn sin ejecutar |
| TOOL-005 | DONE | Segundo intento exige turno nuevo y mismos args dentro de 2 minutos; token single-use |
| TOOL-006 | DONE | Límites globales/por tool, reintentos, transferencia y excepciones con errores seguros |
| TOOL-007 | DONE | Prompt efectivo por capacidad y resultados de mutación públicos sin autoridad directa |
| TOOL-008 | DONE | Tools internas sólo en Voice Lab autorizado; persistencia y calendario aislados |
| UI-001 | DONE | Login/restauración/logout, expiración por 401/deadline y navegación según rol |
| UI-002 | DONE | Esquema v4 y controles generados por modelo con visibilidad/errores por capacidad |
| UI-003 | DONE | Siete secciones editan comportamiento, silencios, canales, confirmación, límites y escalamiento |
| INT-001 | DONE | ARI/RTP cableado por DID confiable al runtime moderno; 41 pruebas focales y typechecks aprobados |
| INT-002 | DONE | Latencia clasificada; configuración preservada; respuestas serializadas y startup SDK acotado; pruebas y documentación verificadas |
| INT-003 | DONE | E2E ARI/RTP → DID/location → agente/tools → cleanup; 306 pruebas, 1 live omitida, ambos typechecks y build aprobados |
| UI-004 | DONE | Preview explícita de configuración guardada en Voice Lab; costo visible, tenant/runtime verificados; 14 pruebas, typechecks y build aprobados |
| UI-005 | DONE | Settings administra sucursales, números, dirección, zona, horarios, cierres, políticas y transferencia con roles/CAS existentes; 24 pruebas, typechecks y build aprobados |
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
