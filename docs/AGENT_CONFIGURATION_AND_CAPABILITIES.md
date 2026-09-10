# Configuración y capacidades actuales del agente

> Estado presente verificado el 10 de septiembre de 2026. Las capacidades
> planeadas se encuentran en `PROJECT_STATUS.md`.

## Construcción de una sesión

```mermaid
flowchart LR
  UI["Dashboard"] --> API["/api/configuration"]
  API --> CFG["AgentConfigurationService"]
  CFG --> DB[("agent_configurations")]
  CALL["CallOrchestrator"] --> DEF["AgentDefinitionService"]
  DB --> DEF
  DEF --> CONV["ConversationService"]
  CONV --> RT["OpenAIRealtimeAdapter"]
  RT --> MODEL["Realtime model"]
  MODEL -->|"function call"| EXEC["ToolExecutor"]
  EXEC --> DOMAIN["Customers / Scheduling / Appointments / Transfer"]
```

El dashboard configura modelo, voz, locale, esfuerzo de razonamiento, límite de
salida, VAD, instrucciones y herramientas. La configuración se valida, persiste
por tenant y aplica a la próxima conversación.

El registro backend de herramientas también es la fuente de los títulos,
descripciones, iconos, clasificación y ruta segura mostrados por el dashboard.
Así una herramienta nueva puede mostrarse con fallback sin romper el panel.

Los valores recomendados se construyen en una única fábrica versionada del
módulo Agents. Bootstrap y el panel consumen esa fábrica; el adaptador Realtime
usa siempre la definición ya resuelta y no sustituye modelo, voz o tokens.

El documento canónico incluye `schemaVersion: 1`. Las configuraciones históricas
sin versión se actualizan en los repositorios de memoria y SQLite, preservando
sus valores y completando sólo campos ausentes. SQLite guarda la forma canónica
al primer acceso y una versión futura desconocida se rechaza.

El adaptador fija todavía PCM mono a 24 kHz, reducción `near_field`, respuesta e
interrupción automáticas, timeout de silencio, tool choice automático y tools
secuenciales. Estas decisiones permanecen documentadas como brecha hasta que el
esquema versionado permita controlar únicamente combinaciones soportadas.

## Herramientas implementadas

| Tool | Acción | Protección principal |
|---|---|---|
| `check_availability` | Consulta slots reales o una hora exacta | Servicio/empleado y zona se resuelven en backend |
| `update_customer` | Guarda nombre completo y teléfono | Cliente procede de la llamada |
| `create_appointment` | Crea y confirma una cita | Requiere slot consultado, ownership e idempotencia |
| `cancel_appointment` | Cancela cita y evento | Verifica cliente propietario |
| `reschedule_appointment` | Valida nuevo slot y sustituye evento | Verifica cliente y compensa fallo externo |
| `transfer_to_human` | Solicita destino configurado | El modelo no proporciona el destino |
| `enable_developer_test_mode` | Activa fixtures aislados | Sólo sesión local autorizada |
| `delete_test_appointments` | Limpia citas de esa prueba | Sólo citas de la sesión de prueba |

`tenantId`, `callId`, `customerId` e idempotencia son contexto confiable y se
rechazan si aparecen en argumentos del modelo. Deshabilitar una herramienta
impide que sea registrada en la sesión.

## Calendario y citas

Availability cruza horarios, duración/buffer, empleados elegibles, ocupación
local y Google FreeBusy. Create vuelve a validar antes de escribir. Google OAuth
se guarda cifrado por tenant y el modelo nunca recibe tokens, otros eventos ni
el motivo por el que una franja está ocupada.

## Datos y privacidad

- No se persisten audio ni transcripciones.
- El consumo guarda tokens, milisegundos de audio y conteos de tools.
- La API key sólo procede del entorno y el panel muestra únicamente su estado.
- Los logs operativos deben conservar tenant/call para correlación sin datos de
  pacientes; el endurecimiento pendiente está trazado en `OBS-001`.
