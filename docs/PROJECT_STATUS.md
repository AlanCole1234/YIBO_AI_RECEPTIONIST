# Estado del proyecto YIBO

Este archivo es la fuente de verdad viva del avance. Los documentos `BASELINE_*`
son históricos y los ADR registran decisiones; ninguno sustituye este tablero.

## Punto verificado

- Fecha: 10 de septiembre de 2026.
- Rama y commit inicial: `main` en `7df03e4`.
- Estado inicial: árbol limpio y sincronizado con `origin/main`.
- Validación inicial: `pnpm typecheck` aprobado; 146 pruebas aprobadas y 1 omitida.
- Checkpoint activo: **Checkpoint 0 — Verdad documental y consistencia**.
- Tarea activa: **DOC-002 — alinear la documentación con el código actual**.

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
- Las mutaciones administrativas no tienen autenticación ni auditoría.
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
| DOC-002 | IN_PROGRESS | Arquitectura, capacidades y guía alineadas con el código actual |
| FIX-001 | TODO | Descriptores completos de tools y dashboard tolerante a extensiones |
| FIX-002 | TODO | Prueba de contrato backend/API/dashboard para tools |
| FIX-003 | TODO | Fábrica única y versionada de defaults del agente |
| AUTH-001 | TODO | Contratos de principal, sesión y roles administrativos |
| AUTH-002 | TODO | Usuarios SQLite, scrypt y comando `admin:create` |
| AUTH-003 | TODO | Login, logout, sesión firmada y `auth/me` |
| AUTH-004 | TODO | Middleware, Origin y rechazo de tenant no confiable |
| AUTH-005 | TODO | Matriz de permisos tenant_admin/operator |
| AUD-001 | TODO | Auditoría administrativa redactada |
| LOC-001 | TODO | Tipos y validación multi-sucursal |
| LOC-002 | TODO | Perfil versionado y upgrader a sucursal default |
| LOC-003 | TODO | Migración SQLite con `location_id` |
| LOC-004 | TODO | Contexto confiable tenant/location por número marcado |
| LOC-005 | TODO | Fixtures y adaptadores en memoria migrados |
| LOC-006 | TODO | API administrativa versionada con edición optimista |
| CAT-001 | TODO | CRUD de servicios compartidos |
| CAT-002 | TODO | CRUD de profesionales y asignaciones |
| PRICE-001 | TODO | Money ISO 4217 por oferta de sucursal |
| PRICE-002 | TODO | Snapshot de nombre y precio en la cita |
| SCHED-001 | TODO | Horario de sucursal intersectado con horario profesional |
| SCHED-002 | TODO | Cierres administrativos privados |
| SCHED-003 | TODO | Políticas estructuradas de agenda |
| SCHED-004 | TODO | Políticas aplicadas a consulta y revalidación |
| SCHED-005 | TODO | Capacidad y concurrencia por profesional/sucursal |
| CAL-001 | TODO | Resolver de calendario por tenant/location/employee |
| CAL-002 | TODO | Fallback de sucursal y override profesional |
| CAL-003 | TODO | Validación y estado de asignaciones Google |
| CAL-004 | TODO | Operaciones Google mediante calendario resuelto |
| TRANSFER-001 | TODO | Destino validado por sucursal |
| TRANSFER-002 | TODO | Transferencia real y estados de llamada |
| AGENT-001 | TODO | Esquema versionado y migración de configuración |
| AGENT-002 | TODO | Compilador de prompt con reglas inmutables |
| AGENT-003 | TODO | Registro de capacidades por modelo |
| AGENT-004 | TODO | Controles soportados de audio, VAD, tracing y truncación |
| AGENT-005 | TODO | Comportamiento conversacional estructurado |
| AGENT-006 | TODO | Políticas de tools por canal, límites y reintentos |
| AGENT-007 | TODO | Paralelismo permitido sólo para tools de lectura |
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
- `tenantId`, `callId` y `customerId` son contexto confiable.
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
