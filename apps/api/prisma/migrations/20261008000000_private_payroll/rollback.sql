-- Operational rollback: disable the payroll module and restore the previous app.
-- Preserve all payroll tables, ciphertext, and referenced key generations.
-- No DROP/DELETE rollback is permitted after private payroll data is written.
SELECT 'Preserve payroll data and encryption keys; application rollback only' AS rollback_guidance;
