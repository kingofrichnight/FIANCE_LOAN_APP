# Lendwise

A static, device-local loan portfolio app published through GitHub Pages.

## Using the app

- Choose a portfolio currency to view that currency’s borrowers and totals. Each loan stores its own currency; amounts are never converted using assumed exchange rates.
- Use **Add borrower** to save contact information, loan terms and optional PDF/image documents.
- Each borrower has **Payments**, **Edit** and **Delete** controls. Deletion requires confirmation. The most recent deletion can be undone in Settings until the page is reloaded.
- **Payments** shows the full monthly schedule. Record or edit the total received for each installment and its latest received date. Partial and overdue payments are supported. Set the received amount to zero to clear the record, with confirmation.
- **Export report** downloads all borrowers and all installments, including contact details, terms, currency, amounts due/received/remaining, dates, status and days late. CSV carries status text; the native `.xlsx` export colors overdue and paid-late rows red. Export status is a snapshot at the report date.
- **Settings & backup** exports/restores a JSON backup including documents and payment records. This is how a portfolio can be transferred to another phone or browser.

## Calculation and storage details

New schedules use monthly reducing-balance amortization, rounded to two decimal places, with a final installment adjustment. Monthly dates retain the original day where possible (January 31 becomes February’s last day, then March 31). No late fees are added automatically. An unpaid installment becomes overdue the day after its due date in the device’s local time.

The app keeps **one received total and one latest received date per installment**, not a transaction ledger. Collection totals group these records by their recorded date. If you need individual receipts across multiple dates for the same installment, export your records and use a transaction ledger.

Data stays in this browser’s local storage and is not synced or backed up to a server. Documents are limited to 1 MB each and 10 per borrower, subject to browser storage capacity. Failed saves show an error and keep the form open. Export backups regularly.

Older `lendwiseBorrowers` data is preserved and loaded without seeded demo records. New saves use a separate versioned storage key; the old key is untouched. Earlier loans had no stored currency or annual rate: their numeric amounts are retained with USD as the legacy denomination and their saved installment is preserved. Verify the currency and dates in Edit, and supply the original rate before changing principal or term. Missing principal/interest splits are blank in exports rather than guessed.

## Development and verification

Serve the repository with any local HTTP server. There is no build step or application backend. The locally vendored ExcelJS 4.4.0 browser bundle is loaded only when exporting Excel; its MIT license is included.

Run calculation and workbook regression tests with `npm test` (Node.js 22+). They cover amortization, rounding, month boundaries, statuses, older records, validation, CSV escaping and XLSX types/styles.

The interaction suite uses Playwright (`npm install --no-save playwright`, then `npx playwright install chromium`). Run `npm run test:ui`; set `BROWSER_CHANNEL=msedge` to use installed Microsoft Edge. The suite starts its own local server and uses only synthetic data in an isolated browser. QA downloads and screenshots go to a sibling `qa` directory, outside this repository. It covers all visible navigation and control families, CRUD, payment editing, documents, exports, backups, phone layout, invalid data and quota failures.
