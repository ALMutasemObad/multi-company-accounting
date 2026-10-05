-- Preserve each encrypted calculation even after a rejection or recalculation.
CREATE TABLE `payroll_run_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `run_version` INTEGER UNSIGNED NOT NULL,
  `encrypted_snapshot` JSON NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `payroll_run_snapshots_run_id_run_version_key` (`run_id`, `run_version`),
  INDEX `payroll_run_snapshots_company_id_run_id_idx` (`company_id`, `run_id`),
  CONSTRAINT `payroll_run_snapshots_run_id_company_id_fkey` FOREIGN KEY (`run_id`, `company_id`) REFERENCES `payroll_runs` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `payroll_run_snapshots` (`run_id`, `company_id`, `run_version`, `encrypted_snapshot`, `snapshot_hash`)
SELECT `id`, `company_id`, `version`, `encrypted_snapshot`, `snapshot_hash` FROM `payroll_runs`
WHERE `encrypted_snapshot` IS NOT NULL AND `snapshot_hash` IS NOT NULL;
