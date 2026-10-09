# Commercial invoicing — owner tool

A professional invoice for commercial customers, built from an editable JSON
source with verified business facts and explicit owner-completion fields.
The website never issues invoices; this is an owner tool
(`docs/operations/FINANCIAL-WORKFLOW.md`).

## Files

| File | Purpose |
| --- | --- |
| `assets/invoicing/commercial-invoice.example.json` | Editable source template (committed; contains no customer data) |
| `scripts/commercial-invoice.mjs` | Builds HTML + plain text + print/email-ready PDF |
| `src/lib/invoicing/invoice.ts` | Pure builder: totals, tax rules, escaping, placeholders |
| `invoice-out/` | Output (git-ignored — completed invoices contain customer data) |

## Usage

```
node scripts/commercial-invoice.mjs --data path/to/your-invoice.json
node scripts/commercial-invoice.mjs --sample      # previews the committed example
```

1. Copy `assets/invoicing/commercial-invoice.example.json` **outside the
   repository** (or to an untracked name) and fill it in.
2. Run the command above. Output:
   - `invoice-out/invoice-<number>.pdf` — print/email-ready (Letter, brand
     styling, background graphics);
   - `invoice-out/invoice-<number>.html` — the source rendering;
   - `invoice-out/invoice-<number>.txt` — plain-text version for the email body.
3. Complete every `[owner to complete]` field before sending. The tool prints a
   warning while any placeholder remains.
4. Attach the PDF; keep the file outside git.

## What the invoice contains

Invoice number · issue date · due date · billed-to company block · service
location · PO/reference · line items (description, quantity, unit price,
amount) · subtotal · total due · payment terms · payment methods ·
notes/scope · company contact block.

## Rules the tool enforces

- **Verified contact only.** The name, phone, email and website are checked
  against `src/config/business.ts`; a drifted value stops the build.
- **No invented financial details.** Bank details, tax IDs, registration
  numbers and late-fee/interest terms are never generated.
- **Tax only when supplied.** A tax row appears only when the owner provides
  both a label and a rate; otherwise it is omitted (never guessed).
- **Explicit owner-completion placeholders.** Unset due date, payment terms and
  legal entity render as `[Due date — owner to complete]`, etc., so an
  incomplete invoice cannot be sent by accident.
- **Arithmetic is deterministic.** Line amounts, subtotal, tax and total are
  computed to the cent from the supplied numbers.
- **Escaped values.** Customer-supplied text is HTML-escaped in the document.

## Owner decisions still required

- **Due date and payment terms** (e.g. net 15/30) — not yet approved; the tool
  leaves them blank rather than inventing terms.
- **Legal entity name** — `business.legalName` remains PENDING; complete the
  placeholder or leave it out knowingly.
- **Tax treatment** — only if commercial cleaning is taxable in the relevant
  jurisdiction; supply the exact label and rate.
- **Payment instructions** — the verified methods list (cards, Apple Pay,
  Google Pay, ACH) is included; any account/wire details must be added by the
  owner, never by the template.

## Testing

`tests/invoice.test.ts` covers the arithmetic, tax rules, placeholders,
escaping, the no-invented-details rule and the plain-text version.
