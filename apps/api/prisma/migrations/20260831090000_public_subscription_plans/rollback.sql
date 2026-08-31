-- Application rollback keeps this additive column. Manual schema rollback removes
-- only public visibility metadata, never prices, subscriptions or payment history.
ALTER TABLE `platform_plan_versions`
  DROP INDEX `platform_plan_versions_public_catalog_idx`,
  DROP COLUMN `publicly_listed`;
