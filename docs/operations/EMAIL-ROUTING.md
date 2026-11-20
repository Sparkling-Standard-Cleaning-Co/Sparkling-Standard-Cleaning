# Email routing and Google Workspace

## Current matrix

| Purpose | Address | Sender / reply behaviour |
| --- | --- | --- |
| Public contact, estimates, booking support, rescheduling, cancellations, complaints, re-cleans | `customer-service@sparkling-standard.com` | Customer email defaults use the verified notifications sender and reply to customer service |
| Recruitment and applicants | `hiring@sparkling-standard.com` | Public careers link and subject; display name `Sparkling Standard | Hiring Team` |
| Billing, invoices, receipts, payment reminders and refund correspondence | `billing@sparkling-standard.com` | Invoice and receipt reply-to address; not the general public support address |
| Internal administration and vendor correspondence | `admin@sparkling-standard.com` | Owner/staff correspondence; not the default public support address |
| Ownership, financial and critical security/backup alerts | `owner@sparkling-standard.com` | Owner notifications, invoices/security and critical alerts |

The public website now uses the customer-service address in business config, the contact page, footer, legal pages, structured data, branch pages and customer email reply-to. Invoice and receipt reply-to defaults use billing. Owner notifications remain addressed to the owner.

## DNS observed on 2026-11-20

- MX: `smtp.google.com` (Google Workspace).
- SPF: `v=spf1 include:_spf.google.com ~all`.
- DMARC: `v=DMARC1; p=none` plus a Cloudflare aggregate-report record.
- Google DKIM selector `google._domainkey` is present.
- A Resend DKIM selector was not found at `resend._domainkey`.

The mailbox existence and Google Workspace account settings were not verified from this environment. Confirm each mailbox, especially `billing@`, in the Google Workspace admin console before relying on it. Do not assume an alias or Google Group can send unless that permission is explicitly configured.

## Owner setup

1. Confirm all five department mailboxes/aliases exist and are able to receive mail.
2. Confirm the Google Workspace sending/alias configuration for `customer-service@`, `billing@`, `hiring@` and `admin@`.
3. Confirm the Resend sender domain is verified. Set `RESEND_REPLY_TO=customer-service@sparkling-standard.com` and `RESEND_BILLING_REPLY_TO=billing@sparkling-standard.com`.
4. Confirm `OWNER_NOTIFICATION_EMAIL=owner@sparkling-standard.com`.
5. If Google Workspace sends as the public addresses, add the required SPF include and DKIM records only after checking the current records. Do not overwrite the existing Google records.
6. Send one internal test message from each mailbox to another internal mailbox; do not send test mail to customers or applicants.
7. Check DMARC reports after the first week and consider a stricter policy only after the sending inventory is stable.
8. In Stripe, verify the automated receipt/email settings. The application sends its own branded receipts; disable Stripe's automatic successful-payment receipt if it would duplicate the application receipt. The Stripe dashboard setting was not changed from this environment.
9. Verify the Stripe Customer Portal configuration if customer self-service invoices/receipts are required. The current application does not expose a dedicated customer billing portal.

## Application behaviour

- Customer confirmations and service correspondence: reply to customer service.
- Invoice emails and payment receipts: reply to billing.
- Owner notifications and critical document alerts: owner address.
- Hiring: public careers link and a mailto subject; no automated applicant tracking system was added.
