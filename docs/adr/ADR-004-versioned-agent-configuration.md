# ADR-004: Configuración versionada del agente

- Estado: Aceptado
- Fecha: 10 de septiembre de 2026
- Alcance: Agents, API, dashboard y persistencia SQLite

## Contexto

La configuración del agente se guardaba como JSON sin discriminador de versión.
Agregar controles nuevos directamente haría que lectores antiguos interpretaran
documentos incompletos o que una actualización reemplazara opciones existentes.

## Decisión

- `AgentConfiguration` canónica incluye `schemaVersion`; la forma desplegada sin
  versión se trata como entrada histórica.
- Todas las fronteras de persistencia pasan documentos por un upgrader puro. En
  SQLite, la primera lectura reescribe la forma canónica dentro del mismo tenant.
- La migración conserva instrucciones, locale, voz, herramientas y controles
  existentes. Sólo completa campos ausentes con defaults conservadores.
- Una versión futura desconocida se rechaza explícitamente; nunca se intenta una
  degradación silenciosa.
- La API sólo devuelve y guarda la forma canónica. Cada evolución incompatible
  incrementará la versión y añadirá un paso explícito al upgrader.
- La separación final en `identity`, `conversation`, `audio`, `behavior` y
  `toolPolicies` se introducirá mediante versiones posteriores del mismo contrato,
  junto con los controles que dependen de esas secciones.

## Consecuencias

- Los documentos actuales migran automáticamente sin una migración SQL destructiva.
- Backend, dashboard y auditoría pueden identificar inequívocamente el esquema.
- Fixtures y adaptadores en memoria ejercitan exactamente la misma actualización
  que SQLite.
