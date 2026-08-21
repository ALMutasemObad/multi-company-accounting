-- Company-scoped, non-fiscal sequences for stable master-data identifiers.
-- Existing customer and supplier codes are preserved. The initial counter is
-- placed after the greatest legacy code that already matches the new format.
CREATE TABLE `master_data_code_sequences` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `entity_type` VARCHAR(40) NOT NULL,
  `prefix` VARCHAR(20) NOT NULL,
  `next_number` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `padding` TINYINT UNSIGNED NOT NULL DEFAULT 6,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `master_data_code_sequences_company_id_entity_type_key` (`company_id`, `entity_type`),
  CONSTRAINT `master_data_code_sequences_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `master_data_code_sequences` (
  `company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`
)
SELECT
  `companies`.`id`,
  'CUSTOMER',
  'CUS-',
  COALESCE(MAX(
    CASE
      WHEN TRIM(`customers`.`code`) REGEXP '^CUS-[0-9]+$'
        THEN CAST(SUBSTRING(TRIM(`customers`.`code`), 5) AS UNSIGNED)
      ELSE 0
    END
  ), 0) + 1,
  6,
  CURRENT_TIMESTAMP(3)
FROM `companies`
LEFT JOIN `customers` ON `customers`.`company_id` = `companies`.`id`
GROUP BY `companies`.`id`;

INSERT INTO `master_data_code_sequences` (
  `company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`
)
SELECT
  `companies`.`id`,
  'SUPPLIER',
  'SUP-',
  COALESCE(MAX(
    CASE
      WHEN TRIM(`suppliers`.`code`) REGEXP '^SUP-[0-9]+$'
        THEN CAST(SUBSTRING(TRIM(`suppliers`.`code`), 5) AS UNSIGNED)
      ELSE 0
    END
  ), 0) + 1,
  6,
  CURRENT_TIMESTAMP(3)
FROM `companies`
LEFT JOIN `suppliers` ON `suppliers`.`company_id` = `companies`.`id`
GROUP BY `companies`.`id`;
