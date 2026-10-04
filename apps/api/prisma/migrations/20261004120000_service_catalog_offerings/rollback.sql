-- Expand-only operational rollback: disable the service-catalog routes/module and
-- retain definitions, audit, and sequence history. Never drop used definitions.
SELECT
  (SELECT COUNT(*) FROM `service_categories`) AS `retained_service_categories`,
  (SELECT COUNT(*) FROM `service_offerings`) AS `retained_service_offerings`,
  (SELECT COUNT(*) FROM `service_offering_variants`) AS `retained_service_variants`;
