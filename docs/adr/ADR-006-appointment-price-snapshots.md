# ADR-006: Precio por oferta y snapshot histórico en citas

- Estado: Aceptado
- Fecha: 10 de septiembre de 2026
- Alcance: Business, Appointments, Scheduling y herramientas

## Contexto

Un servicio puede tener precios distintos por sucursal y cambiar con el tiempo.
Una cita histórica no puede reinterpretarse usando el precio vigente del
catálogo, y un importe decimal no representa dinero de forma exacta.

## Decisión

- El precio de cada oferta sucursal–servicio es `Money { amountMinor, currency }`.
- `amountMinor` es un entero seguro no negativo; `currency` pertenece al
  catálogo ISO 4217 y se guarda en mayúsculas.
- Al crear una cita se copia el nombre del servicio y su `Money`; esos campos no
  se recalculan si cambia o desaparece el catálogo.
- El precio es informativo. Este alcance no autoriza cobros, pagos, impuestos ni
  conversión de monedas.

## Consecuencias

- Business valida dinero al guardar cualquier configuración.
- Appointments será dueño del snapshot y su migración persistente.
- Las herramientas pueden informar el precio, pero no ejecutan transacciones.
- La forma v2 transitoria con `priceAmountMinor`/`priceCurrency` se actualiza al
  leerla para no invalidar configuraciones creadas antes de este ADR.
