import {
  buildInvoice,
  formatInvoiceDate,
  type BuiltInvoice,
  type InvoiceData,
  type InvoiceLineItem,
} from './invoice.ts';
import { CUSTOMER_EMAIL_BUSINESS } from '../forms/customer-email.ts';
import { EMAIL_ROUTING } from '../../config/email-routing.ts';

export function buildAdminInvoice(input: {
  invoice: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  review?: { url: string; eligible: boolean; branchName?: string };
}): BuiltInvoice {
  const invoice = input.invoice;
  const customerName = [invoice.first_name, invoice.last_name].filter(Boolean).join(' ').trim();
  const companyName = String(invoice.company_name ?? '').trim();
  const email = String(invoice.customer_email ?? '').trim();
  const phone = String(invoice.customer_phone ?? '').trim();
  const addressLines = [invoice.line1, invoice.line2, [invoice.city, invoice.state, invoice.postal_code].filter(Boolean).join(' ')]
    .map((line) => String(line ?? '').trim())
    .filter(Boolean);
  const lineItems: InvoiceLineItem[] = input.lines
    .filter((line) => !['discount', 'tax'].includes(String(line.kind)))
    .map((line) => {
      const quantity = Math.max(0, Number(line.quantity) || 1);
      const total = Math.max(0, Number(line.total_cents) || 0) / 100;
      return {
        description: String(line.description ?? 'Cleaning services').trim() || 'Cleaning services',
        quantity,
        unitPrice: quantity > 0 ? total / quantity : total,
      };
    });
  if (lineItems.length === 0) {
    lineItems.push({
      description: 'Cleaning services',
      quantity: 1,
      unitPrice: Math.max(0, Number(invoice.subtotal_cents) || 0) / 100,
    });
  }

  const dueDate = String(invoice.due_date ?? '').slice(0, 10);
  const serviceDate = String(invoice.service_date ?? '').slice(0, 10);
  const serviceName = String(invoice.service_name ?? '').trim();
  const paymentUrl = String(invoice.payment_url ?? '').trim();
  const data: InvoiceData = {
    invoiceNumber: String(invoice.number ?? ''),
    issueDate: String(invoice.issue_date ?? '').slice(0, 10),
    dueDate,
    ...(serviceDate ? { serviceDate } : {}),
    ...(serviceName ? { serviceName } : {}),
    billedTo: {
      company: companyName || customerName || 'Customer',
      ...(companyName && customerName ? { contact: customerName } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      addressLines,
    },
    serviceLocation: addressLines.join(', '),
    lineItems,
    discountLabel: 'Discount',
    discountAmount: Math.max(0, Number(invoice.discount_cents) || 0) / 100,
    ...(Number(invoice.tax_cents) > 0
      ? { taxLabel: 'Sales tax', taxAmount: Math.max(0, Number(invoice.tax_cents)) / 100 }
      : {}),
    amountPaid: Math.max(0, Number(invoice.amount_paid_cents) || 0) / 100,
    balanceDue: Math.max(0, Number(invoice.balance_cents) || 0) / 100,
    paymentTerms: dueDate
      ? `Payment is due by ${formatInvoiceDate(dueDate)}.`
      : 'Please contact us to arrange payment.',
    ...(paymentUrl && /^https:\/\//i.test(paymentUrl) ? { paymentUrl } : {}),
    ...(input.review ? { review: input.review } : {}),
    contact: {
      name: CUSTOMER_EMAIL_BUSINESS.name,
      phone: CUSTOMER_EMAIL_BUSINESS.phone ?? '',
      email: EMAIL_ROUTING.billing,
      website: CUSTOMER_EMAIL_BUSINESS.website,
      legalName: 'Sparkling Standard LLC',
    },
  };
  return buildInvoice(data);
}
