-- Public marketing is opt-in per immutable price version. No existing price is exposed.
ALTER TABLE `platform_plan_versions`
  ADD COLUMN `publicly_listed` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD INDEX `platform_plan_versions_public_catalog_idx` (`publicly_listed`, `effective_from`, `id`);
