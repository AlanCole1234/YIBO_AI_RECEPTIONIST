# Mapa de configuración, modelo y capacidades

## Flujo de control

```mermaid
flowchart LR
  UI["YiboApiConfiguration<br/>Web Component"] --> API["DevAudioHarness API"]
  API --> CS["AgentConfigurationService"]
  CS --> CR["AgentConfigurationRepository"]
  CR --> DB[("SQLite regional<br/>agent_configurations")]

  CALL["CallOrchestrator"] --> ADS["AgentDefinitionService"]
  ADS --> CR
  ADS --> DEF["AgentDefinition<br/>instrucciones + tools permitidas<br/>conversation behavior + contexto confiable"]
  DEF --> CONV["ConversationService"]
  CONV --> RT["ConversationRuntimePort"]
  RT --> OA["OpenAIRealtimeAdapter"]
  OA --> MODEL["Modelo Realtime"]

  MODEL -->|"tool.call: datos no confiables"| CONV
  CONV --> TE["ToolExecutor"]
  TE -->|"consulta"| SCH["Scheduling"]
  TE -->|"mutación validada"| APP["Appointments"]
  TE -->|"acción externa"| HUMAN["HumanTransferPort"]
  TE -->|"resultado seguro + toolCallId"| CONV
  CONV --> RT

  RT -->|"usage"| CONV
  CONV --> UR["ConversationUsageRecorder"]
  UR --> USAGE[("SQLite regional<br/>conversation_usage")]
  API --> URD["ConversationUsageReader"]
  URD --> USAGE
```

## Permisos efectivos

| Configuración | El modelo puede solicitar | Autoridad final |
|---|---|---|
| `check_availability` | Consultar servicios y horarios disponibles | `SchedulingService` |
| `create_appointment` | Proponer la creación de una cita | `ToolExecutor` valida argumentos; `Appointments` revalida disponibilidad e idempotencia |
| `cancel_appointment` | Proponer cancelar una cita | `ToolExecutor` verifica que pertenece al cliente confiable; `Appointments` ejecuta |
| `transfer_to_human` | Solicitar transferencia | `HumanTransferPort` y su configuración externa |
| Tool deshabilitada | Nada: no se registra en la sesión | `AgentDefinitionService` filtra antes de abrir la conversación |

`tenantId`, `callId` y `customerId` nunca son elegidos por el modelo. Proceden del contexto confiable construido por `calls`.

## UML de contratos

```mermaid
classDiagram
  class AgentConfigurationService {
    +get(tenantId)
    +update(tenantId, configuration)
    +recommended(locale, businessName, model)
  }
  class AgentConfigurationRepository {
    <<port>>
    +getConfiguration(tenantId)
    +saveConfiguration(tenantId, configuration)
  }
  class AgentDefinitionService {
    +prepare(trustedContext)
  }
  class ConversationService {
    +start(command)
  }
  class ConversationRuntimePort {
    <<port>>
    +openSession(input)
  }
  class ToolExecutor {
    <<application boundary>>
    +execute(context, call)
  }
  class ConversationUsageRecorder {
    <<port>>
    +record(increment)
  }

  AgentConfigurationService --> AgentConfigurationRepository
  AgentDefinitionService --> AgentConfigurationRepository
  AgentDefinitionService --> ToolExecutor
  ConversationService --> ConversationRuntimePort
  ConversationService --> ToolExecutor
  ConversationService --> ConversationUsageRecorder
```

## Privacidad y observabilidad

- Se persisten únicamente tokens, milisegundos de audio, número de tools, `tenantId`, `callId` y timestamp.
- No se persisten API keys, prompts, transcripciones ni audio.
- La API key permanece exclusivamente en `OPENAI_API_KEY`.
- El panel muestra si existe una key, nunca su contenido.
