ALTER TABLE appointments
  ADD COLUMN service_name_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE appointments
  ADD COLUMN price_amount_minor INTEGER NOT NULL DEFAULT 0;

ALTER TABLE appointments
  ADD COLUMN price_currency TEXT NOT NULL DEFAULT '';

UPDATE appointments AS appointment
SET service_name_snapshot = COALESCE((
      SELECT json_extract(service.value, '$.name')
      FROM businesses AS business, json_each(business.profile_json, '$.services') AS service
      WHERE business.region_id = appointment.region_id
        AND business.tenant_id = appointment.tenant_id
        AND json_extract(service.value, '$.id') = appointment.service_id
      LIMIT 1
    ), appointment.service_id),
    price_amount_minor = COALESCE((
      SELECT COALESCE(
        json_extract(offer.value, '$.price.amountMinor'),
        json_extract(offer.value, '$.priceAmountMinor')
      )
      FROM businesses AS business,
        json_each(business.profile_json, '$.locations') AS location,
        json_each(location.value, '$.services') AS offer
      WHERE business.region_id = appointment.region_id
        AND business.tenant_id = appointment.tenant_id
        AND json_extract(location.value, '$.id') = appointment.location_id
        AND json_extract(offer.value, '$.serviceId') = appointment.service_id
      LIMIT 1
    ), 0),
    price_currency = COALESCE((
      SELECT COALESCE(
        json_extract(offer.value, '$.price.currency'),
        json_extract(offer.value, '$.priceCurrency')
      )
      FROM businesses AS business,
        json_each(business.profile_json, '$.locations') AS location,
        json_each(location.value, '$.services') AS offer
      WHERE business.region_id = appointment.region_id
        AND business.tenant_id = appointment.tenant_id
        AND json_extract(location.value, '$.id') = appointment.location_id
        AND json_extract(offer.value, '$.serviceId') = appointment.service_id
      LIMIT 1
    ), CASE appointment.region_id WHEN 'MX' THEN 'MXN' ELSE 'USD' END);
