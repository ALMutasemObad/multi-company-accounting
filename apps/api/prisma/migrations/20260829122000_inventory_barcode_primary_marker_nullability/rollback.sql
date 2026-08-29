-- DESTRUCTIVE: weakens the primary-barcode database invariant and reopens the
-- SQL UNKNOWN case for primary rows with a NULL primary_inventory_item_id.
ALTER TABLE `inventory_item_barcodes`
  DROP CONSTRAINT `inventory_item_barcodes_primary_marker_nullability_chk`;
