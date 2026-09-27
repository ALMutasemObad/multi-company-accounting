# Serial publications and inventory labels

## Barcode impact

Inventory owns the scannable item barcode. The `(companyId, normalizedValue)` uniqueness rule remains unchanged: a scan must never silently resolve to an arbitrary issue. The catalog now stores a separate, optional `publicationIdentifier` for the printed ISBN, ISSN, EAN, or publisher number. That field is deliberately **not unique**, is not a scan lookup key, and is searchable in the catalog. `issueNumber`, `periodicalYear` (the periodical's numbered year/volume), and `publicationYear` (Gregorian year) are separate descriptive fields. The primary barcode remains unique for each inventory item; leaving it blank generates a short company-scoped Code 128 barcode. Do not treat a repeated publication identifier as an inventory-item identifier or generate a public GS1/ISBN number.

The read-only source workbook `الجرد 27-9-2026.xlsx` has 731 titled rows, 651 non-empty printed identifiers, 633 distinct identifier strings, and six repeated identifier groups covering 24 rows. For example, `13190148` appears against multiple issues of مجلة الدارة. This sample supports a shared serial identifier plus issue-specific inventory records. The workbook mixes 8-, 10-, 13- and other-length strings; some 13-digit values fail EAN-13 check-digit validation. Import must preserve each source identifier as **text** and must not attach an ambiguous repeated value as the unique scannable barcode automatically. This change imports no source rows.

## Configurable thermal label

Company-scoped settings select a 50 × 25 or 75 × 50 mm PDF label, the default barcode type for manual entry, and whether to show the item name, publication year, periodical year, issue number, or human-readable barcode text. The default label is 50 × 25 mm with only the scannable barcode and its human-readable value shown, per the user's latest choice. A value that is too wide returns `LABEL_TOO_WIDE`; the operator must assign a shorter unique scan barcode or a larger label for that item. The existing PNG download remains available. The print operation is still performed by the browser and local Windows printer driver; the server cannot assert that a physical printer printed a label.

## Catalog-only import

The user-selected 237 counted rows from the source workbook were prepared into a catalog-only XLSX under `tmp/import-prep/darah-counted-catalog-only.xlsx`. The amount counted is used only to select rows; it is deliberately absent from the output. A second review workbook records how each row matched the richer book list: 141 strong two-signal matches were enriched; 96 retain the original count-sheet title and identifier because the richer file could not be matched safely. Neither source workbook was modified, and no item or balance has been imported to a database yet.

The new catalog import API accepts a bounded XLSX/CSV template, previews all rows, and commits atomically only when there are no errors. Its optional `periodical_year` column is distinct from `publication_year`. It creates a unique scannable code for each new item and uses `(companyId, importSourceKey)` to skip a source row on repeated import. It does not set any inventory balance or movement. The import file itself is not part of the code repository and must be reviewed before any production commit.

At local inspection on 2026-09-27, a Zebra GK888t (EPL) USB device was enumerated as healthy on USB002, but Windows had no Zebra printer queue and no ZDesigner driver. A physical print/scan round trip remains an acceptance gate after installing the official driver and configuring 50 × 25 mm gap labels. This observation is machine-local, not a deployed-system capability.
