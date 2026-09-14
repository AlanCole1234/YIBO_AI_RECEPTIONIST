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

## Consecuencia aplicada — AGENT-004

El 14 de septiembre de 2026 el esquema canónico avanzó a versión 2. El paso
v1→v2 materializa `identity`, `conversation`, `audio` y `enabledTools`, conserva
los valores históricos y asigna defaults explícitos para reducción de ruido,
VAD, inactividad, tracing y truncación. Tanto documentos sin versión como v1 se
reescriben a v2; aplicar el upgrader nuevamente no modifica el resultado.

Los modos de turno son una unión discriminada (`server_vad`, `semantic_vad` o
manual) para impedir combinaciones de campos inválidas. PCM mono a 24 kHz queda
fuera del documento por ser una invariante del transporte. Tracing permanece
deshabilitado por defecto como decisión de privacidad.

## Consecuencia aplicada — AGENT-005

El 14 de septiembre de 2026 el esquema avanzó a versión 3 para añadir
`behavior`. La migración v2→v3 asigna defaults conservadores y localizados sin
reinterpretar la guía editable. Saludo, estilo de respuesta, silencios, oferta
de slots y orden de recopilación son campos enumerados y validados; el prompt
libre no puede sustituirlos porque el compilador los coloca después de la guía
administrativa.

El adaptador no contiene ya políticas conversacionales propias: recibe un prompt
compilado. Dos comportamientos necesitan control de runtime y no sólo una
instrucción: el saludo automático inicia una respuesta explícita y las
repreguntas por silencio se cancelan al alcanzar su límite configurado.
