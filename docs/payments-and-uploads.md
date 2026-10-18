# Payments, receipt storage and production requirements

## How payments are modelled
| Table | One row is | Notes |
|---|---|---|
| `payments` | a payment **commitment** for one lead and one course/internship | committed amount, commitment date, responsible BDE |
| `payment_instalments` | money **actually received** against a commitment | amount, payment date. A full payment is one instalment; partial payments are several |
| `payment_receipts` | metadata of one uploaded proof file | file name shown to people, detected type, size, SHA-256. The file itself is on disk |

* **Status (Pending / Partially Paid / Paid) is never typed or stored.** It is derived: nothing received = Pending, received less than committed = Partially Paid, received equals committed = Paid. A stored status could contradict the money; a derived one cannot.
* **Revenue is the sum of instalment rows, each counted once.** Commitments and instalments are aggregated in separate sub-queries, so a commitment is never multiplied by its number of instalments. The integration tests compare the totals with independent plain SQL.
* **Over-payment is impossible.** Adding or editing an instalment locks the payment row inside a transaction and checks the total against the commitment, so two simultaneous requests cannot both succeed. Tested with parallel requests against real MySQL.
* **Amounts** are `DECIMAL(12,2)`, handled as integers of hundredths in code and exchanged as strings (`"12500.00"`), so there is no floating-point rounding. No currency is stored (the PDF names none).
* **Ownership is enforced three times:** in the service, in the SQL (`WHERE user_id = ?`), and by the database (composite foreign keys make it impossible to store a payment, instalment or receipt whose BDE is not the lead's owner).

## Receipt / screenshot upload
`POST /api/payment-instalments/:id/receipts?name=<display name>` with the **file itself as the request body** and `Content-Type: image/jpeg`, `image/png` or `application/pdf`. BDE only, own instalments only. Optional `&confirmDuplicate=1`.

| Rule | Value | Where |
|---|---|---|
| Accepted types | JPEG, PNG, PDF | `lib/receipt-file.js` |
| How the type is decided | the file's first bytes, not its name or the header. The declared header must also match | `sniffReceiptType` |
| Refused | HTML, SVG, GIF, WebP, HEIC, executables, text, empty files, anything else | |
| Maximum size | `RECEIPT_MAX_BYTES`, default 5 MB. Larger gives HTTP 413 | config + `express.raw` |
| Files per instalment | 5 | `MAX_RECEIPTS_PER_INSTALMENT` |
| Stored name | random UUID + extension chosen by the server. The uploaded name is only kept (cleaned) for display | `lib/receipt-storage.js` |
| Same file attached twice | warned (409). Other BDEs' matches are only counted. Confirm to attach anyway | service |

### Where files are stored and how they are served
* Files are written to `RECEIPT_STORAGE_DIR` (default for development: `backend/storage/receipts`, ignored by git). The folder is created with mode `0700` and files `0600`.
* **The API serves no static files at all** (a test checks the source). A file can only be reached through `GET /api/payment-receipts/:id/file` (the owning BDE) or `GET /api/admin/payment-receipts/:id/file` (Admin), both needing a login. A BDE asking for another BDE's file gets 404.
* Download responses carry `Content-Type` from the detected type, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: default-src 'none'; sandbox`, and a generated file name. Images open inline; PDFs are always downloaded.
* API responses never contain the stored file name or any disk path.
* If the database write fails after the file was written, the file is deleted again. If a file goes missing from disk, the API answers 404 and logs it on the server.

### CSRF note
Every other write endpoint requires `Content-Type: application/json`. The upload route is the only exception: it accepts the three file types above. These are not "simple" cross-site content types, so a browser first sends a CORS pre-flight, which this API never approves. Session cookies are also `SameSite=Lax`. A test checks that the upload route is the only write route registered before the JSON guard.

## Production requirements (none of this can be checked from the code alone)
1. Set `RECEIPT_STORAGE_DIR` to an **absolute path outside the application folder and outside any folder a web server publishes** (for example `/var/lib/bde-app/receipts`). The server prints a warning at start-up in production if it is not set, and refuses to start if the folder cannot be created.
2. Run the API under a dedicated operating-system account; only that account may read or write the folder (`0700`). No execute permission anywhere.
3. Put the folder on **persistent storage** and **back it up together with the database**. The database holds only references; a restored database without its files (or the reverse) leaves proofs unavailable.
4. Monitor free disk space (5 MB x many receipts adds up) and decide a retention policy (see the TL decisions).
5. Serve everything over **HTTPS** and run with `NODE_ENV=production` (secure cookies). If a reverse proxy is used, set `TRUST_PROXY=1`, and make its body-size limit at least `RECEIPT_MAX_BYTES` (for nginx: `client_max_body_size`).
6. **Add malware scanning** of uploads (for example ClamAV) if the company's policy requires it. It is **not implemented**.
7. Consider object storage with a private bucket and encryption at rest instead of local disk if the API runs on more than one server (local disk is not shared).

## Security limitations (what this implementation does NOT do)
* **Content is not scanned or re-encoded.** Checking the first bytes stops disguised HTML/SVG/scripts, but a crafted file that starts like a JPEG/PNG/PDF can still carry other content. It is served with `nosniff` and a sandboxing policy and never as a web page, but it is not proven harmless. PDFs may contain active content and open in the user's own viewer after download.
* **Image metadata is kept** (EXIF such as location or device) because files are stored unchanged.
* **No delete or replace of uploaded proof**, and **no audit trail** of who changed what. A wrong file stays attached (up to 5 per instalment).
* **No verification step.** Admin can view proof but cannot approve or reject it. Nothing checks that the file really matches the amount.
* **No upload-specific rate limit** (only the login attempt limit exists).
* **Files are not encrypted by the application**; rely on disk or storage encryption.
* A crash between writing the file and the database row could leave an unreferenced file. No clean-up job exists.
* Duplicate-file detection catches only byte-identical files.
* Admin can open every proof across the team; receipts may contain personal data (names, phone numbers, bank details).

## Interview "payment confirmed" flag (Phase 6 change)
* **Before (Phase 5):** a yes/no box the BDE ticked on the interview (`interviews.payment_confirmed`).
* **Now:** derived from payment records and read-only. An interview shows "Payment confirmed: yes" when **a payment record (commitment) exists for the same lead**. The single definition is `backend/src/lib/payment-confirmed-sql.js`; to change the rule (for example "some money has been received") change only that expression.
* A `paymentConfirmed` value sent to the interview API is **ignored** (not an error). The interview filter "Payment confirmed" and the Admin interview overview use the derived value.
* **Migration impact:** migration `010` only adds a comment to the old column; it is no longer read or written, and no values are changed or deleted. Any interview whose old flag was 1 **but whose lead has no payment record now shows "No"** until the BDE records the payment. To list them before going live:
  ```sql
  SELECT i.id AS interview_id, l.candidate_name, u.employee_id
    FROM interviews i JOIN leads l ON l.id = i.lead_id JOIN users u ON u.id = i.user_id
   WHERE i.payment_confirmed = 1 AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.lead_id = i.lead_id);
  ```
  Amounts cannot be invented for these rows, so no automatic back-fill is provided. Drop the old column only after the TL confirms the rule.
* Phase 5 tests that expected a typed flag were changed to expect this behaviour (listed in the README).
