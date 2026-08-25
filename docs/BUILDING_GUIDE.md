# Guía para seguir construyendo YIBO

## 1. Cómo orientarse

Antes de implementar una historia, responder en este orden:

1. ¿Qué módulo es dueño del comportamiento?
2. ¿Qué contrato público lo expresa?
3. ¿Qué datos son confiables y cuáles vienen del usuario o de la IA?
4. ¿Qué invariantes deben permanecer?
5. ¿Qué puerto necesita el caso de uso?
6. ¿Qué prueba demuestra el resultado?

Si requiere cambiar límites entre módulos, registrar primero un ADR en `docs/adr/`. Si sólo cambia tecnología externa, implementar otro adaptador detrás del puerto existente.

## 2. Ruta recomendada por incrementos

### Fase 1 — Composition root y escenario end-to-end en memoria

Objetivo: demostrar una llamada simulada que crea una cita confirmada usando todos los módulos conectados.

- Crear `src/bootstrap/`.
- Construir explícitamente repositorios, servicios y adaptadores en memoria.
- Crear fakes de telefonía, agente IA y streams de voz.
- Añadir una prueba `tests/e2e/in-memory-call-to-appointment.test.ts`.
- Centralizar un reloj y generadores de IDs inyectables.

Terminado cuando un evento `INCOMING_CALL` recorre Calls → Agents → ToolExecutor → Appointments y termina en una cita `CONFIRMED`.

### Fase 2 — Persistencia PostgreSQL

Objetivo: hacer durable el estado de negocio, clientes, llamadas y citas.

- Elegir y documentar librería de DB/migraciones.
- Versionar tablas y constraints multi-tenant.
- Implementar repositorios PostgreSQL detrás de los puertos.
- Implementar exclusión/concurrencia transaccional por recurso e intervalo.
- Añadir pruebas de integración contra una base efímera.

Constraints mínimos: unicidad `(tenant_id, phone_normalized)` para clientes, `(tenant_id, idempotency_key)` para citas y protección contra solapamientos confirmados por empleado.

### Fase 3 — Calendario real

Objetivo: consultar ocupación y reflejar citas en un proveedor.

- Estabilizar/exportar un contrato público común de calendario.
- Implementar autorización y credenciales por tenant.
- Mapear errores del SDK a errores del puerto.
- Añadir idempotencia, timeouts, rate limiting y pruebas de contrato.
- Diseñar reconciliación/reintentos de estados `FAILED`.

No introducir un segundo proveedor hasta cerrar el primer recorrido real.

### Fase 4 — Proveedor de IA y voz real

Objetivo: abrir una sesión realtime y ejecutar tools con contexto seguro.

- Implementar `AgentAIProvider` y/o consolidar el límite con `VoiceAIProvider` mediante una decisión explícita.
- Mantener `tenantId`, `customerId`, `callId` e idempotencia fuera de los argumentos del modelo.
- Instrumentar inicio/cierre, tool calls, latencia y errores.
- Definir política de retención antes de almacenar audio o transcripción.

### Fase 5 — Telefonía

Objetivo: recibir una llamada real mediante Asterisk/ARI sin implementar SIP/RTP propio.

- Añadir el módulo `telephony` con contrato público.
- Adaptar eventos externos a `TelephonyEvent`.
- Implementar answer, hangup, audio stream y transferencia.
- Conectar transferencia con estados `TRANSFERRING` y `TRANSFERRED`.
- Probar shutdown idempotente y pérdida de conexión.

### Fase 6 — API, operaciones y dashboard

Objetivo: configurar tenants y operar el sistema con seguridad.

- API de configuración/autenticación y health/readiness.
- Observabilidad estructurada, métricas y trazas.
- Recuperar o reconstruir el fuente del dashboard; no editar `dashboard/dist` manualmente.
- Gestión de servicios, empleados, horarios, integraciones y destinos de transferencia.
- Auditoría de cambios y autorización por tenant.

## 3. Patrón para añadir una funcionalidad

Ejemplo: recordatorios de cita.

```text
appointments/domain       define si una cita admite recordatorio
appointments/application  caso de uso para programarlo
appointments/ports        NotificationPort / ReminderRepository
appointments/infrastructure adaptadores concretos
appointments/index.ts     exporta sólo el contrato necesario
tests/appointments        prueba invariantes y errores
bootstrap                 conecta implementaciones
```

No colocar envío de SMS dentro de la entidad ni importar el SDK del proveedor desde `application`.

## 4. Checklist de una tarea

Antes:

- Identificar módulo dueño y consumidores.
- Leer su `index.ts`, contratos, puertos y pruebas.
- Confirmar reglas de multi-tenancy, tiempo, idempotencia y concurrencia.
- Definir aceptación observable.

Durante:

- Mantener el cambio dentro del módulo principal.
- Depender de interfaces y APIs públicas.
- Validar datos en la frontera.
- Usar errores tipados y mensajes seguros.
- Añadir pruebas de éxito, fallo y aislamiento por tenant cuando aplique.

Después:

- Ejecutar `pnpm typecheck` y `pnpm test`.
- Confirmar que no se filtraron SDKs o infraestructura entre módulos.
- Actualizar arquitectura/ADR si cambió un contrato.
- Verificar cierre y compensación de recursos externos.

## 5. Comandos

```sh
pnpm install
pnpm typecheck
pnpm test
```

Si Corepack intenta descargar otra versión de pnpm en un entorno sin red, pueden ejecutarse los binarios ya instalados en `node_modules/.bin`; esto sólo sirve cuando las dependencias locales ya existen.

## 6. Convenciones prácticas

- Los imports ESM TypeScript terminan en `.js` porque se usa `NodeNext`.
- Mantener `strict` y `noUncheckedIndexedAccess`.
- Los IDs tipados hoy son aliases de `string`; no asumir que protegen en runtime.
- Fechas de entrada deben validarse y normalizarse a ISO UTC.
- No usar `data/*.sqlite` como fuente oficial hasta que exista esquema, migraciones y adaptador documentados.
- No colocar lógica de negocio en controllers, webhooks, adaptadores o prompts.
- No comunicar éxito al caller antes del éxito del caso de uso.

## 7. Definition of Done del próximo hito

El primer vertical slice técnico queda terminado cuando:

- existe un composition root;
- una prueba end-to-end conecta los módulos sin mocks internos del dominio;
- una llamada simulada resuelve tenant y cliente;
- el agente solicita disponibilidad y creación mediante tools;
- la cita queda `CONFIRMED` en repositorio y calendario fake;
- el hangup cierra voz y agente una sola vez;
- todos los eventos se pueden correlacionar por `callId` y `tenantId`;
- typecheck y suite completa pasan.

