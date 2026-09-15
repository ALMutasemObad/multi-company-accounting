CREATE TABLE `inventory_item_images` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `content_hash` CHAR(64) NOT NULL,
  `media_type` VARCHAR(40) NOT NULL,
  `width` SMALLINT UNSIGNED NOT NULL,
  `height` SMALLINT UNSIGNED NOT NULL,
  `original_bytes` INT UNSIGNED NOT NULL,
  `inventory_thumb_bytes` INT UNSIGNED NOT NULL,
  `pos_thumb_bytes` INT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `inventory_item_images_item_company_key` (`inventory_item_id`, `company_id`),
  INDEX `inventory_item_images_company_updated_idx` (`company_id`, `updated_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `inventory_item_images_company_fk`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_item_images_item_company_fk`
    FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items` (`id`, `company_id`)
    ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
