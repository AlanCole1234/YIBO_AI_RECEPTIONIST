# ADR-007: Confirmación de mutaciones solicitadas por IA

- Estado: Aceptado
- Fecha: 14 de septiembre de 2026

## Contexto

Una instrucción conversacional no es una frontera de autorización. Reservar,
actualizar contacto, cancelar o reprogramar puede modificar estado aunque el
modelo haya entendido mal al caller. La confirmación debe ser comprobable por el
backend y no puede depender de que el modelo repita una frase.

## Decisión

`AgentConfiguration.toolPolicies.confirmations.requiredFor` enumera únicamente
tools mutables habilitadas. El default queda vacío para conservar instalaciones
existentes. `ConfirmationGateToolExecutor` envuelve al ejecutor que aplica
límites, de modo que un intento no confirmado no alcanza el dominio ni consume
una ejecución externa.

El primer intento genera un token criptográficamente aleatorio y lo liga en
memoria a `callId`, nombre de tool, argumentos canónicos y `turnSequence`
confiable. El modelo nunca aporta la secuencia. La confirmación válida exige los
mismos argumentos, una nueva intervención del caller, no más de dos minutos y
consumo único del token. Cualquier diferencia falla cerrada.

## Consecuencias

- Los schemas de mutaciones configurables admiten `confirmationToken`; el gate
  lo elimina antes de delegar al dominio.
- `ConversationService` asigna una secuencia monótona a turnos de voz y texto y
  la añade sólo al ejecutar tools.
- Los tokens no se persisten, no sirven entre llamadas y no contienen IDs ni
  argumentos decodificables.
- TOOL-004 implementa emisión y binding fail-closed. TOOL-005 completa la ventana
  temporal, el requisito de turno nuevo y el consumo de un solo uso.
