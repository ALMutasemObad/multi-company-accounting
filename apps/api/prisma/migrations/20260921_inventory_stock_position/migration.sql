-- Inventory owned outside company warehouses, and third-party inventory held by us.
-- InventoryBalance remains the sole source for owned stock held in our warehouses.

CREATE TABLE `external_inventory_parties` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(200) NOT NULL,
  `name_en` VARCHAR(200) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `external_inventory_parties_company_code_key` (`company_id`, `code`),
  UNIQUE INDEX `external_inventory_parties_id_company_key` (`id`, `company_id`),
  INDEX `external_inventory_parties_company_active_name_idx` (`company_id`, `is_active`, `name_ar`),
  CONSTRAINT `external_inventory_parties_text_chk` CHECK (
    CHAR_LENGTH(TRIM(`code`)) > 0 AND CHAR_LENGTH(TRIM(`name_ar`)) > 0
  ),
  CONSTRAINT `external_inventory_parties_company_fk`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `external_stock_positions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `custody_party_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NULL,
  `position_type` ENUM(
    'THIRD_PARTY_HELD_BY_US',
    'OWNED_HELD_BY_THIRD_PARTY',
    'OWNED_IN_TRANSIT'
  ) NOT NULL,
  `position_key_hash` CHAR(64) NOT NULL,
  `external_location` VARCHAR(300) NULL,
  `transit_origin` VARCHAR(300) NULL,
  `transit_destination` VARCHAR(300) NULL,
  `quantity` DECIMAL(19, 6) NOT NULL DEFAULT 0,
  `inventory_value_base` DECIMAL(19, 4) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_event_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `external_stock_positions_company_key_hash_key` (`company_id`, `position_key_hash`),
  UNIQUE INDEX `external_stock_positions_id_company_key` (`id`, `company_id`),
  INDEX `external_stock_positions_company_type_item_idx` (`company_id`, `position_type`, `inventory_item_id`),
  INDEX `external_stock_positions_company_party_type_idx` (`company_id`, `custody_party_id`, `position_type`),
  INDEX `external_stock_positions_company_warehouse_type_idx` (`company_id`, `warehouse_id`, `position_type`),
  CONSTRAINT `external_stock_positions_quantity_chk` CHECK (`quantity` >= 0),
  CONSTRAINT `external_stock_positions_key_hash_chk` CHECK (CHAR_LENGTH(`position_key_hash`) = 64),
  CONSTRAINT `external_stock_positions_shape_chk` CHECK (
    (
      `position_type` = 'THIRD_PARTY_HELD_BY_US'
      AND `warehouse_id` IS NOT NULL
      AND `external_location` IS NULL
      AND `transit_origin` IS NULL
      AND `transit_destination` IS NULL
      AND `inventory_value_base` IS NULL
    ) OR (
      `position_type` = 'OWNED_HELD_BY_THIRD_PARTY'
      AND `warehouse_id` IS NULL
      AND CHAR_LENGTH(TRIM(`external_location`)) > 0
      AND `transit_origin` IS NULL
      AND `transit_destination` IS NULL
      AND `inventory_value_base` >= 0
    ) OR (
      `position_type` = 'OWNED_IN_TRANSIT'
      AND `warehouse_id` IS NULL
      AND `external_location` IS NULL
      AND CHAR_LENGTH(TRIM(`transit_origin`)) > 0
      AND CHAR_LENGTH(TRIM(`transit_destination`)) > 0
      AND TRIM(`transit_origin`) <> TRIM(`transit_destination`)
      AND `inventory_value_base` >= 0
    )
  ),
  CONSTRAINT `external_stock_positions_company_fk`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `external_stock_positions_item_company_fk`
    FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `external_stock_positions_party_company_fk`
    FOREIGN KEY (`custody_party_id`, `company_id`) REFERENCES `external_inventory_parties` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `external_stock_positions_warehouse_company_fk`
    FOREIGN KEY (`warehouse_id`, `company_id`) REFERENCES `warehouses` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `external_stock_position_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `external_stock_position_id` BIGINT UNSIGNED NOT NULL,
  `event_type` ENUM('INCREASE', 'DECREASE', 'REVALUATION', 'REVERSAL') NOT NULL,
  `position_type_snapshot` ENUM(
    'THIRD_PARTY_HELD_BY_US',
    'OWNED_HELD_BY_THIRD_PARTY',
    'OWNED_IN_TRANSIT'
  ) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `quantity_delta` DECIMAL(19, 6) NOT NULL,
  `inventory_value_base_delta` DECIMAL(19, 4) NULL,
  `source_type_snapshot` VARCHAR(40) NOT NULL,
  `source_reference_snapshot` VARCHAR(100) NOT NULL,
  `effective_date` DATE NOT NULL,
  `reversal_of_event_id` BIGINT UNSIGNED NULL,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `external_stock_events_company_idempotency_key` (`company_id`, `idempotency_key`),
  UNIQUE INDEX `external_stock_events_reversal_company_key` (`reversal_of_event_id`, `company_id`),
  UNIQUE INDEX `external_stock_events_id_company_key` (`id`, `company_id`),
  INDEX `external_stock_events_company_position_date_id_idx` (`company_id`, `external_stock_position_id`, `effective_date`, `id`),
  INDEX `external_stock_events_company_type_date_idx` (`company_id`, `position_type_snapshot`, `effective_date`),
  CONSTRAINT `external_stock_events_text_chk` CHECK (
    CHAR_LENGTH(TRIM(`idempotency_key`)) > 0
    AND CHAR_LENGTH(TRIM(`source_type_snapshot`)) > 0
    AND CHAR_LENGTH(TRIM(`source_reference_snapshot`)) > 0
  ),
  CONSTRAINT `external_stock_events_valuation_chk` CHECK (
    (`position_type_snapshot` = 'THIRD_PARTY_HELD_BY_US' AND `inventory_value_base_delta` IS NULL)
    OR (`position_type_snapshot` <> 'THIRD_PARTY_HELD_BY_US' AND `inventory_value_base_delta` IS NOT NULL)
  ),
  CONSTRAINT `external_stock_events_kind_chk` CHECK (
    (`event_type` = 'INCREASE' AND `quantity_delta` > 0 AND (`inventory_value_base_delta` IS NULL OR `inventory_value_base_delta` >= 0) AND `reversal_of_event_id` IS NULL)
    OR (`event_type` = 'DECREASE' AND `quantity_delta` < 0 AND (`inventory_value_base_delta` IS NULL OR `inventory_value_base_delta` <= 0) AND `reversal_of_event_id` IS NULL)
    OR (`event_type` = 'REVALUATION' AND `quantity_delta` = 0 AND `inventory_value_base_delta` <> 0 AND `reversal_of_event_id` IS NULL)
    OR (`event_type` = 'REVERSAL' AND `reversal_of_event_id` IS NOT NULL AND (`quantity_delta` <> 0 OR `inventory_value_base_delta` <> 0))
  ),
  CONSTRAINT `external_stock_events_company_fk`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `external_stock_events_position_company_fk`
    FOREIGN KEY (`external_stock_position_id`, `company_id`) REFERENCES `external_stock_positions` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `external_stock_events_reversal_company_fk`
    FOREIGN KEY (`reversal_of_event_id`, `company_id`) REFERENCES `external_stock_position_events` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `external_stock_events_created_by_fk`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The service exposes this ledger as append-only and corrections use a REVERSAL
-- event. Do not enforce immutability with database triggers: production MySQL
-- runs with binary logging and a least-privilege migration user, where CREATE
-- TRIGGER requires SUPER (or log_bin_trust_function_creators).
