-- Close the SQL three-valued-logic gap in the original primary-state check.
-- This independent invariant is deliberately total for the NOT NULL is_primary flag:
-- primary rows require a marker, while non-primary rows must not carry one.
ALTER TABLE `inventory_item_barcodes`
  ADD CONSTRAINT `inventory_item_barcodes_primary_marker_nullability_chk`
  CHECK (
    (`is_primary` = TRUE AND `primary_inventory_item_id` IS NOT NULL)
    OR
    (`is_primary` = FALSE AND `primary_inventory_item_id` IS NULL)
  );
