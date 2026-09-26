# Estado del proyecto YIBO

Este archivo es la fuente de verdad viva del avance. Los documentos `BASELINE_*`
son históricos y los ADR registran decisiones; ninguno sustituye este tablero.

## Launch candidate — preflight telefónico — 26 de septiembre de 2026

- RISK-001 `3046c82` y Google real `a437ea2` completos y respaldados.
- **ACCEPT-001 bloqueado**: SSH y GET ARI info/applications/channels/bridges
  agotan timeout desde esta Mac. No confirma caída del servicio; red/host/firewall
  aún sin diagnóstico. No se pudo verificar dialplan actual ni recursos activos.
- No llamada, subscription ARI, cambio de 7001/from-pstn, reload/restart ni nueva
  configuración. Se conserva el rollback previamente verificado.
- Operador: restablecer acceso a PBX por red privada; después inspección read-only,
  propuesta/permiso explícito para ruta aislada y llamada real del usuario.
  [Evidencia y pasos](LAUNCH_PHONE_PREFLIGHT.md). Despliegue/restore/piloto no iniciados.

## Launch candidate — Google real — 26 de septiembre de 2026

- **Checkpoint 4 completo**, código `3046c82` en `codex/yibo-launch-candidate`.
  Calendario existente **YIBO Test Appointments**, aplicación/SQLite privados nuevos,
  datos sintéticos y telefonía/Realtime/email deshabilitados.
- Grant existente refresca HTTP 200. Almacén original abierto sólo lectura, copia
  cifrada privada; sin cambiar OAuth, mappings, configuración live ni main.
- FreeBusy real → dos reservas → recuperar/verificar → dos reprogramaciones del
  mismo ID → rechazo de cancelación obsoleta sin request a Google → cancelar.
  HTTP 200/204; hora/zona local exactas, revisiones 2→3→4→5, sin duplicados.
- Vecino sintético intacto durante cambios/cancelación; los **15 eventos previos**
  conservan ID/etag. Limpieza verificada de ambas citas, estados locales CANCELLED,
  IDs originales conservados y cero claims pendientes.
- **38 verificaciones live y 31/31 pruebas Google focales aprobadas**. Typechecks,
  build y suite 679+1 ya verdes para este mismo código; checkpoint sólo documental.
- [Evidencia y límites](LAUNCH_GOOGLE_ACCEPTANCE.md). Siguiente gate: **ACCEPT-001**,
  llamada real por ruta aislada aprobada. 7001 permanece revertido; no se reintentó
  routing ni se simula una aceptación de voz. Despliegue/restore y piloto pendientes.

## Launch candidate — RISK-001 — 26 de septiembre de 2026

- **Checkpoint 3 completo** en `codex/yibo-launch-candidate`; conserva integración
  `6b82aa9` y regresión `1ce4b07`. Sin cambios a main ni configuración live.
- Cuatro carreras reproducidas antes de corregir: reprogramación tardía revivía
  cancelación local, outcome perdido, cancelación duplicada e historial desactualizado.
- Crear/reprogramar/cancelar/outcome comparten guardia de sucursal y releen dentro
  de ella. Migración 11 añade revisiones y claims SQLite entre procesos API/voz.
  UI y referencias de voz comparan versión; conflictos rechazan sin escritura externa
  ni reintento automático. Se mantiene el ID original y vecinos intactos.
- **15 pruebas nuevas; 679 aprobadas, 1 live opcional omitida**, 90 archivos aprobados;
  ambos typechecks/build. Copias MX/US 9→11, defaults/versiones, idempotencia y reopen.
- Browser sintético 3113/5381: dos pestañas Office/Product rechazan cancelación
  obsoleta, recargan hora actual y permiten cancelar tras revisión; dos cambios,
  una cancelación e intervalo liberado. Sin proveedores live.
- Claims no expiran: tras caída se reconcilia Google/local antes de liberar el claim
  exacto. Todos los writers deben actualizarse juntos; clientes HTTP legacy sin
  `If-Match` conservan compatibilidad, sin detección de intención obsoleta.
- [Contrato, evidencia y recuperación](APPOINTMENT_EDIT_PROTECTION.md).
  Siguiente gate del PDF: **Google real en calendario aislado**, después ACCEPT-001;
  7001 permanece revertido, sin nueva autorización de routing.

## Launch candidate — regresión completa — 25 de septiembre de 2026

- Integración `6b82aa9` respaldada en `origin/codex/yibo-launch-candidate`;
  ramas fuente `7078d49` / `785389f` conservadas. Sin cambios a main ni servicios live.
- **664 pruebas aprobadas, 1 live opcional omitida**, 88 archivos aprobados;
  ambos typechecks y build de producción aprobados.
- Fixtures RTP/PBX requieren sockets loopback fuera del sandbox. Dos scripts E2E
  históricos de rutas Calendar ahora confirman/persisten contacto antes de reservar;
  conservan todas sus verificaciones de identidad, vecinos, mapping, cambios y borrado.
- **Checkpoint 2 completo.** Siguiente paso del PDF: **RISK-001**, concurrencia de
  citas. Gates de Google real, teléfono, despliegue/restore y piloto pendientes.
  [Registro de validación](LAUNCH_CANDIDATE.md).

## Launch candidate — integración — 25 de septiembre de 2026

- Plan autorizado: `YIBO_Alan_Codex_Instructions.pdf`, leído completo (6 páginas).
  Rama dedicada **`codex/yibo-launch-candidate`**, creada desde Product/UX.
- Remotos verificados con fetch y `ls-remote`: Product/UX
  `7078d49e8ad312f2f4ab797ee184d2e933818297`; Business Operations
  `785389f3c6aea89c2f4d26ec1a7b433669f6b668`; integración telefónica
  `46ce7135a6e6118c14c387b103957868a672645e`, ya ancestro de Product/UX.
  Divergencia real al integrar: **10 commits Product/UX / 9 Operations**.
- Se conserva el checkout telefónico con sus cambios locales, ambos branches fuente,
  `main`, configuración de 7001, proveedores live y credenciales. Merge con dos
  padres; sin squash, reset, force-push ni despliegue.
- Integración conserva Appointments/Availability de Product/UX y Office schedule,
  Customers, Team availability, outcomes, notificaciones y roles de Operations.
  Mantiene políticas/overrides, precios redactados, readback configurable, locale,
  contacto confirmado, lifecycle Voice Lab y costos por sesión.
- Correcciones de integración: timeline verifica sucursal antes de devolver emails;
  controles legacy se normalizan antes del baseline de cambios sin guardar;
  acciones de oficina respetan estados/permisos visibles. OAuth conserva la sonda
  de eventos ya verificada e incorpora diagnóstico de revocación/API deshabilitada.
- **291 pruebas focales distintas aprobadas (18 nuevas)**, ambos typechecks y build.
  Browser aislado 3113/5381, SQLite sintético/calendario en memoria: crear en Office →
  historial Customers → reprogramar en Appointments → cancelar en Office;
  mismo registro, timeline/notifications `SKIPPED`, slot liberado y layout 390 px.
  No se iniciaron Google, Resend, Asterisk ni Realtime live.
- **Checkpoint 1 completo**; las verificaciones live históricas no certifican esta
  combinación. Próximo gate: regresión completa del candidato (checkpoint 2), después
  **RISK-001** (checkpoint 3). Google real, ACCEPT-001, despliegue/restore y piloto
  siguen pendientes según el PDF. [Evidencia y decisiones](LAUNCH_CANDIDATE.md).

## Product/UX — Appointments Calendar UI — 24 de septiembre de 2026

- **Checkpoint completo** en `codex/product-ux-improvements`; conserva `7510f7a`
  y todos los checkpoints anteriores. El usuario aceptó por ahora las comprobaciones
  manuales de Voice Lab y autorizó expresamente este alcance.
- Appointments ofrece día, semana y agenda; navegación por fecha, sucursal,
  profesional y citas canceladas. Muestra nombres del cliente/profesional, estado,
  zona local y precios históricos; incluye citas pasadas y estados que necesitan revisión.
- Reserva manual con cliente por teléfono reutiliza el find-or-create existente,
  Availability UI y los APIs actuales. Reprogramar/cancelar reutiliza el editor,
  políticas de aviso, validación de capacidad/slots, identidad del evento y Calendar.
- Nuevo read de calendario (máximo 31 días, sin truncar citas) reutiliza repositorios
  SQLite/in-memory, CustomerReader y configuración existente. Aislamiento de
  región/tenant/sucursal; sin migración, nuevo motor, Customer Profiles ni Email Notifications.
- **119 checks focales distintos aprobados** (26 nuevos), ambos typechecks y build.
  Browser aislado: crear → reprogramar → cancelar, persistencia al abrir otra página,
  mismo ID/evento sin duplicados, hora liberada, filtros, historial y layout móvil 390 px.
  Cita de prueba cancelada; configuración live, telefonía/7001, OAuth/Google y main intactos.
- [Alcance, API, evidencia, límites y puntos de integración](PRODUCT_UX_APPOINTMENTS_CALENDAR.md).
  Pendiente antes del piloto: smoke test de UI contra un Calendar de prueba real.
  Las citas conservan el contrato existente sin versión/CAS; no se promete protección
  nueva entre procesos o contra ediciones simultáneas.
- Siguiente checkpoint recomendado: **protección de conflictos al editar citas**
  para varios usuarios de oficina. No iniciado; coordinar contratos con el compañero.

## Product/UX — aceptación aislada de reglas de voz — 24 de septiembre de 2026

- `1184fff` se conserva. Siete conversaciones de audio sintético con Realtime real
  verifican precios/permisos, overrides, idioma, readback y configuración nueva por sesión.
- Reserva → reprogramación → cancelación local aprobadas sin revelar precios;
  ninguna cita de esta aceptación queda activa. No se utilizó Google ni telefonía live.
- `0994bf1` corrige eventos started etiquetados como failed y cierre cuando end_call
  precede al audio de despedida; fallo de despedida termina como error, sin espera infinita.
  Cuatro conversaciones posteriores terminaron automáticamente una sola vez.
- Guía de tools aclara fecha/rango ya soportados; prompt exige hablar en hora local
  conservando timestamps originales. Sin cambios al motor de agenda o parser.
- **127 checks focales aprobados**, ambos typechecks y build. Configuración sintética
  restaurada exactamente; captura deshabilitada; `main`, servicio telefónico y OAuth intactos.
- **Aceptación del usuario**: las comprobaciones manuales de cadencia, micrófono,
  barge-in y reinicio/audio son aceptables por ahora; no se afirman nuevas mediciones automáticas.
  [Matriz PASS / MANUAL REQUIRED, fallos observados y guion exacto](MODEL_CONFIGURATION_VOICE_ACCEPTANCE.md).
  El usuario autorizó después Appointments Calendar UI; resultado arriba.

## Product/UX — Model Configuration Pipeline — 24 de septiembre de 2026

- **Checkpoint completo** en `codex/product-ux-improvements`; `25eb2f4` y `904dc11`
  se conservan. Auditoría reutiliza AgentConfiguration v4 y negocio/sucursales v2.
- AI agent → Business rules expone precios y reserva/cancelación/reprogramación
  usando los permisos existentes. Precios permitidos por default para conservar
  comportamiento; al deshabilitarlos, prompt y resultados de herramientas lo aplican.
- Settings → Locations añade overrides opcionales de acciones, precios, idioma y
  readback. Herencia por default; una sucursal no puede habilitar permisos denegados
  por negocio/canal. Disponibilidad conserva las políticas ya implementadas en A/C.
- Persistencia, validación, tenant/contexto confiable, versiones y conflictos en los
  mismos APIs; sin nuevo almacén ni cambios a Customer Profiles/Email Notifications.
- **105 pruebas focales aprobadas (27 nuevas)**, ambos typechecks y build. Browser
  sintético: guardado/reload, aislamiento entre sucursales, validación, herencia,
  teclado y ancho móvil. Sin llamada/modelo live, Calendar/OAuth ni telefonía.
- [Campos/defaults/consumidores, evidencia y límites](MODEL_CONFIGURATION_PIPELINE.md).
  Aceptación de audio sintético completada después; el usuario aceptó por ahora la
  parte manual y autorizó Appointments Calendar UI (arriba). Sin merge a main.

## Product/UX — Checkpoint C — 23 de septiembre de 2026

- **Checkpoint C completo**: Availability UI usa sucursal/servicio/profesional,
  fecha y rango horario local; separa opciones solicitadas y alternativas con fecha/zona.
- Estados vacío/error/carga, selección explícita, limpieza al cambiar filtros y
  rechazo de respuestas antiguas. Reserva con la sucursal/instante seleccionados;
  abre la cita correcta y conserva la revalidación del dominio.
- Settings expone la política de sugerencias existente (habilitar, 1–14 días,
  1–5 alternativas) mediante el mismo API, permisos y CAS. Sin motor duplicado.
- **67 pruebas focales aprobadas (28 nuevas)**, ambos typechecks y build. Browser
  con datos sintéticos: dos sucursales, reserva/reprogramación/cancelación,
  persistencia de controles, teclado y ancho móvil verificados.
- [Alcance, contratos, pruebas y límites](PRODUCT_UX_CHECKPOINT_C.md). Sin cambios
  de producción, Calendar/OAuth, telefonía, `main` ni rama del compañero.
- Model Configuration Pipeline se completó después de C; ver el checkpoint superior.

## Product/UX — aceptación A/B — 23 de septiembre de 2026

- **Aceptación A/B completa**: UI de moneda/readback, conflictos entre pestañas,
  historial móvil/teclado verificados; el usuario confirmó que Voice Lab manual pasó.
- Corregido el título del editor de moneda a “Display currency”, sin cambiar precios.
- Evidencia y límites: [aceptación A/B](PRODUCT_UX_AB_ACCEPTANCE.md). Entorno aislado
  con datos sintéticos/calendario local; no implica aceptación telefónica o despliegue.
- Checkpoint C — Availability UI autorizado después de este cierre; completado arriba.

## Product/UX — Checkpoint B — 23 de septiembre de 2026

- **Checkpoint B completo** en `codex/product-ux-improvements`; `5e578fe` se conserva.
- Recent Activity conserva el historial, limita la altura a 14rem y permite inspeccionar
  entradas antiguas sin desplazamiento forzado; botón para volver a la actividad reciente.
- Dashboard Test y Voice Lab comparten un ciclo de sesión: finalización idempotente,
  limpieza de audio/socket/colas/timers y nueva prueba sin recargar ni perder configuración.
- Cierre automático mediante `end_call` existente y confirmación del navegador de que
  terminó la reproducción; eventos repetidos/manuales no generan otra respuesta.
- **96 pruebas focales aprobadas (33 nuevas)**, ambos typechecks y build de producción.
  Fixture de navegador verificado con 304 entradas, cierre automático/manual y reinicio.
- Aceptación de micrófono/modelo y UI móvil cerrada; ver [evidencia A/B](PRODUCT_UX_AB_ACCEPTANCE.md) y
  [alcance, estados, pruebas y riesgos](PRODUCT_UX_CHECKPOINT_B.md).
- Sin cambios a Asterisk/7001, servicio telefónico, OAuth, Calendar o `main`.
  Availability UI no se incluyó en B; se completó después como Checkpoint C.

## Product/UX — Checkpoint A — 23 de septiembre de 2026

- Rama separada: `codex/product-ux-improvements`, base `46ce713`.
- **Checkpoint A completo**: alternativas de disponibilidad configurables por sucursal,
  lectura de teléfono agrupada/dígito a dígito consumida por el agente y moneda de
  presentación USD/MXN/EUR sin conversión ni cambios de precios históricos.
- **136 pruebas focales aprobadas (27 nuevas)**, ambos typechecks y build de producción.
- Aceptación manual de voz/UI cerrada. Integración con el trabajo del compañero pendiente.
  Ver [alcance, configuración y resultados](PRODUCT_UX_CHECKPOINT_A.md).
- Sin cambios de Asterisk/7001, servicio telefónico, OAuth ni `main`. No se inició
  Checkpoint B dentro de A; B se documenta arriba. El estado de integración siguiente se conserva como checkpoint previo.

## Estado histórico — 22 de septiembre de 2026

- Roadmap de software completo hasta **REL-002** en `codex/integrate-telephony-and-finish`.
- Auditoría focal de negocio: **482 pruebas aprobadas, 1 live omitida**, ambos typechecks y build; guardia de rutas cubre desactivación.
- OAuth aislado recuperado desde autorización vigente; verificación corregida para scopes de eventos, 13 pruebas focales aprobadas. Callback nuevo y acceso a Cloud/MFA pendientes: [diagnóstico](GOOGLE_AUTH_DIAGNOSIS.md).
- **Prueba real todavía bloqueada** por ruta telefónica aislada; operaciones Google reales aún no verificadas. Riesgos de edición simultánea y búsqueda por IDs documentados en [readiness](BUSINESS_TEST_READINESS.md).
- Próximo paso: **ACCEPT-001 / DEPLOY-001**, operador del entorno objetivo; no equivalen a aceptación de producción ya realizada.
- Plan de operaciones iniciado en `codex/yibo-business-operations`: auditoría
  funcional e implementación agrupada completadas; typecheck, 477 pruebas y build
  de producción aprobados. La aceptación live permanece separada.
- Ver alcance, evidencia y límites en [auditoría final](RELEASE_CLOSURE_AUDIT.md). Sin merge a main ni despliegue.

## Historial de checkpoints verificados

- Fecha: 10 de septiembre de 2026.
- Rama y commit inicial: `main` en `7df03e4`.
- Estado inicial: árbol limpio y sincronizado con `origin/main`.
- Validación inicial: `pnpm typecheck` aprobado; 146 pruebas aprobadas y 1 omitida.
- Checkpoint 7 — Paneles administrativos: **cerrado** (UI-001 a UI-009 completos).
- Validación de integración: 306 pruebas aprobadas, 1 live omitida; ambos typechecks y build aprobados; reprogramación conserva el ID Google con etag y ownership.
- REL-002 cerrada el 20 de septiembre de 2026 tras verificar CLOSE-001/CLOSE-002 y repetir el checkpoint completo.
- Aceptación live y preparación del despliegue siguen a cargo del operador (ACCEPT-001 / DEPLOY-001).
- CLOSE-002 verificada el 20 de septiembre de 2026: guardia atómica impide cambiar calendario efectivo de citas no canceladas (incluidas pendientes/fallidas); sin migración de eventos ni esquema. 477 pruebas aprobadas, 1 live omitida; ambos typechecks y build. Ver `BOOKED_CALENDAR_ROUTES.md`.
- CLOSE-001 verificada el 19 de septiembre de 2026: end_call de sesión phone, respuesta/audio/drain y cola RTP final; interrupción cancela cierre, acciones pendientes/inciertas bloquean cierre. 465 pruebas aprobadas, 1 live omitida; ambos typechecks y build. Ver `CALL_COMPLETION.md`.
- REL-002 auditada el 19 de septiembre de 2026: documentación reconciliada; E2E-002 reabierta para dos compromisos previos no cubiertos. Aceptación live y preparación del despliegue tienen responsables explícitos. Ver `RELEASE_CLOSURE_AUDIT.md`.
- REL-001 verificada el 19 de septiembre de 2026: ensayo en copias privadas de ambas bases locales; 443 pruebas aprobadas y 1 live omitida, ambos typechecks y build. Fuentes sin citas/clientes: preservación de esos registros sólo cubierta con fixtures. Ver `REGIONAL_MIGRATION_REHEARSAL.md`; aceptación live pendiente.
- DOC-003 verificada el 19 de septiembre de 2026: arquitectura/diagrama actualizados, catálogo de configuración y runbooks de administración, diagnóstico, migración/recuperación; referencias históricas marcadas. 42 enlaces locales verificados, 12 pruebas focales, ambos typechecks y build aprobados. Sólo documentación; ensayo regional REL-001 y aceptación live pendientes.
- E2E-002 verificada el 19 de septiembre de 2026: 13 escenarios nuevos y 57 pruebas focales aprobadas; ambos typechecks y build aprobados. Listado/cambios/cancelación, transferencia, fallos Google/PBX/media y competencia por slot; sin cambios de producción. Ver `PHONE_OPERATIONS_E2E.md`; validación live pendiente.
- E2E-001 verificada el 17 de septiembre de 2026: 2 escenarios nuevos, 68 pruebas focales aprobadas; ambos typechecks y build aprobados. DID → sucursal/precio → disponibilidad → contacto → confirmación → cita → adaptador Google, con RTP local y proveedores simulados; llamada real pendiente. Ver `VOICE_BOOKING_E2E.md`.
- SEC-001 verificada el 17 de septiembre de 2026: 87 pruebas focales; suite completa 428 aprobadas y 1 live omitida; ambos typechecks y build aprobados. Aislamiento regional/tenant/sucursal, contexto confiable de tools, confirmaciones y ARI; ver `SECURITY_ISOLATION.md`.
- OBS-001 verificada el 17 de septiembre de 2026: 65 pruebas focales; suite completa 394 aprobadas y 1 live omitida; ambos typechecks y build aprobados. Logs correlacionados sin contenido personal, métricas acotadas y percentiles por llamada; ver `OBSERVABILITY.md`.
- UI-009 verificada el 17 de septiembre de 2026: 67 pruebas focales; suite completa 383 aprobadas y 1 live omitida; ambos typechecks y build aprobados. Avisos de borrador y guardado condicional atómico de configuración del agente; ver `OPTIMISTIC_EDITING.md`.
- UI-008 verificada el 17 de septiembre de 2026: 31 pruebas focales; suite completa 374 aprobadas y 1 live omitida; ambos typechecks y build aprobados. Lista por cliente/sucursal, snapshot histórico, cancelación y reprogramación; ver `APPOINTMENT_ADMINISTRATION.md`.
- UI-007 verificada el 17 de septiembre de 2026: 71 pruebas focales en 6 archivos, ambos typechecks y build aprobados. Mapeos de calendario por sucursal/profesional, fallback y verificación segura; ver `CALENDAR_ADMINISTRATION.md`.
- UI-006 verificada el 16 de septiembre de 2026: 69 pruebas focales en 8 archivos, ambos typechecks y build de producción aprobados. Catálogos, precios por sucursal, profesionales, asignaciones y horarios; ver `CATALOG_ADMINISTRATION.md`.
- UI-005 verificada el 15 de septiembre de 2026: 24 pruebas focales aprobadas, ambos typechecks y build de producción aprobados.
- Baseline recuperado verificado localmente: 270 pruebas aprobadas, 1 omitida; ambos typechecks y build aprobados el 15 de septiembre de 2026.
- Preservación local completa: `backup/alan-local-before-integration` (`54e4b9b`), backup remoto de `edd624e`, bundle privado verificado para ambos stashes y reflog. Ver `INTEGRATION_INVENTORY.md`.
- Checkpoint 7 cerrado: 383 pruebas aprobadas, 1 live omitida,
  ambos typechecks y build aprobados el 17 de septiembre de 2026.
- Verificación histórica: AGENT-004; `pnpm typecheck`, 223 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Verificación histórica: AGENT-005; `pnpm typecheck`, 227 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Verificación histórica: AGENT-006; `pnpm typecheck`, 235 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Verificación histórica: AGENT-007; `pnpm typecheck`, 237 pruebas aprobadas y
  1 omitida el 14 de septiembre de 2026.
- Verificación histórica: AGENT-008; `pnpm typecheck` y pruebas focales de
  agente, conversación, Realtime y PCM aprobadas el 14 de septiembre de 2026.
- Verificación histórica: AGENT-009; payloads de ambos modelos y rechazo previo
  a conexión aprobados; suite completa 243/243, 1 omitida y build aprobados el
  14 de septiembre de 2026.
- Verificación histórica: TOOL-001; `pnpm typecheck` y 43 pruebas focales de
  tools, configuración, API, bootstrap y SQLite aprobadas el 14 de septiembre
  de 2026.
- Verificación histórica: TOOL-002; `pnpm typecheck` y 55 pruebas focales de
  dominio, tools, configuración, API y SQLite aprobadas el 14 de septiembre de
  2026.
- Verificación histórica: TOOL-003; `pnpm typecheck` y 37 pruebas focales de
  tools, definición, API y payload Realtime aprobadas el 14 de septiembre de
  2026.
- Verificación histórica: TOOL-004; `pnpm typecheck` y 38 pruebas focales de
  configuración, gate, secuencia de conversación y políticas aprobadas el 14 de
  septiembre de 2026.
- Verificación histórica: TOOL-005; `pnpm typecheck` y 30 pruebas focales de
  expiración, turno nuevo, replay, fallos y conversación aprobadas el 14 de
  septiembre de 2026.
- Verificación histórica: TOOL-006; `pnpm typecheck` y 34 pruebas focales de
  límites, excepciones, confirmación y conversación aprobadas el 14 de septiembre
  de 2026.
- Verificación histórica: TOOL-007; `pnpm typecheck` y 40 pruebas focales de
  prompt, tools, API, modo de prueba y flujo E2E en memoria aprobadas el 14 de
  septiembre de 2026.
- Verificación histórica: TOOL-008; 53 pruebas focales aprobadas; suite completa
  261/261, 1 omitida y build aprobados el 14 de septiembre de 2026.
- Verificación histórica: UI-001; `pnpm typecheck`, 10 pruebas focales de sesión,
  API y roles, y `pnpm build` aprobados el 14 de septiembre de 2026.
- Verificación histórica: UI-002; `pnpm typecheck`, 8 pruebas focales de registro
  y API, y `pnpm build` aprobados el 14 de septiembre de 2026.
- Verificación histórica: UI-003; `pnpm typecheck`, 21 pruebas focales de panel,
  políticas, configuración y API, y `pnpm build` aprobados el 14 de septiembre
  de 2026.

## Capacidades existentes

- Runtime OpenAI Realtime speech-to-speech y runtime en memoria.
- Configuración de agente persistida por tenant y laboratorio de voz.
- Herramientas para disponibilidad, contacto, creación, cancelación y
  reprogramación de citas, transferencia y pruebas locales autorizadas.
- Google Calendar con OAuth, FreeBusy y creación/cancelación de eventos.
- API Fastify, dashboard Vue, persistencia SQLite regional y gateway Asterisk.

## Brechas conocidas al iniciar (históricas; no pendientes actuales)

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
| UI-006 | DONE | Catálogos con duración/buffer, precios por sucursal, profesionales y asignaciones de servicios/horarios; roles, validación y CAS existentes; 69 pruebas, typechecks y build aprobados |
| UI-007 | DONE | Mapeos por sucursal/profesional con fallback visible, verificación de acceso, roles y CAS; 71 pruebas, typechecks y build aprobados |
| UI-008 | DONE | Lista por cliente/sucursal, precio histórico y operaciones según rol/política; 374 pruebas completas, 1 live omitida, typechecks y build aprobados |
| UI-009 | DONE | Avisos de cambios sin guardar, conflictos explícitos y CAS atómico del agente; Checkpoint 7 cerrado con 383 pruebas, 1 omitida, typechecks y build |
| OBS-001 | DONE | Correlación por tenant/sucursal/llamada, allowlist sin PII, VAD/tools/confirmaciones/calendario/transferencia y latencia/RTP/p50/p95; 394 pruebas, typechecks y build |
| SEC-001 | DONE | 34 regresiones nuevas; scope completo de estado/tokens, argumentos hostiles y ARI inválido; 428 pruebas, typechecks y build |
| E2E-001 | DONE | Dos sucursales/precios/zonas, fallback/override Google, gate/éxito diferido, RTP y limpieza; 68 pruebas y build; validación live pendiente |
| E2E-002 | DONE | 13 escenarios originales más cierre de llamada y rutas protegidas de CLOSE-001/CLOSE-002; aceptación live separada |
| DOC-003 | DONE | Diagramas y runbooks finales |
| REL-001 | DONE | Copias MX/US schema 4→9, integridad/preservación/idempotencia/restore; 443 pruebas, typechecks y build; sin migrar originales |
| REL-002 | DONE | Auditoría final, documentación reconciliada, 477 pruebas + 1 live omitida, ambos typechecks/build; gates operativos con responsable |

## Seguimiento de cierre

| ID | Estado | Responsable funcional y resultado requerido |
|---|---|---|
| CLOSE-001 | DONE | ADR-008, end_call de sesión, guardas de acciones/interrupción y flush RTP final; 465 pruebas y build |
| CLOSE-002 | DONE | Política de mapping protegida atómicamente por citas no canceladas; histórico/pending/fallos, override/fallback y E2E Google. Ver BOOKED_CALENDAR_ROUTES.md |
| ACCEPT-001 | TODO | Operador de despliegue: aceptación live y browser con datos de prueba |
| DEPLOY-001 | TODO | Operador de despliegue: respaldo durable, claves, admins, red y datos objetivo |
| RISK-001 | DONE | Revisiones + guardia SQLite compartida, relectura bajo lock, conflictos UI/voz, dos procesos/fallos/identidad; 679 pruebas, 1 live omitida; APPOINTMENT_EDIT_PROTECTION.md |
| RISK-002 | TODO | Producto/secretaría: validar flujo por IDs y necesidad de agenda/búsqueda antes de uso diario; BUSINESS_TEST_READINESS.md |

## Plan de operaciones del negocio

| ID | Estado | Resultado |
|---|---|---|
| OPS-000 | DONE | Auditoría y matriz de brechas de configuración contra código actual |
| OPS-001 | DONE | Workspace día/semana/mes/agenda, filtros, huecos y reserva rápida |
| OPS-002 | DONE | Búsqueda, perfil e historial tenant-scoped de clientes |
| OPS-003 | DONE | Reglas estructuradas de agenda y capacidades IA por sucursal |
| OPS-004 | DONE | Eventos, outcomes y correo Resend posterior al commit |
| OPS-005 | DONE | Roles operativos y modo read-only con guard transversal |
| OPS-006 | DONE | Readiness de proveedores/sucursales y reconexión ARI; typecheck, 477 pruebas + 1 live omitida y build aprobados |
| OPS-007 | TODO | Aceptación browser, PBX, Google y correo real con datos sintéticos; requiere operador y credenciales live |
| OPS-008 | DONE | Hora hablada localizada, contacto confirmado antes de reservar, doctor/dirección post-reserva y cierre explícito de llamada |
| OPS-009 | DONE | Variante oral ligada al locale: es-MX exige español y acento mexicano neutral; el saludo automático se genera en el idioma configurado |
| OPS-010 | DONE | Voice Lab muestra duración, uso detallado y costo estimado en vivo con tarifas versionadas por modelo; la factura del proveedor sigue siendo autoritativa |

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
