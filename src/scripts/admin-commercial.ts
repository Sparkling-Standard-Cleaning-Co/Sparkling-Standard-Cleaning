// Commercial accounts, custom proposal builder, agreement sending and billing.
// Shared admin authentication is server-enforced; this module uses the CSRF
// token exposed by the main admin controller.

interface CommercialScope {
  locations: Array<{
    propertyId: string;
    name: string;
    address: string;
    notes: string;
    areas: Array<{
      name: string;
      notes: string;
      tasks: Array<{ name: string; frequency: string; monthlyCents: number }>;
    }>;
  }>;
  oneTimeCharges: Array<{ label: string; amountCents: number }>;
  addOns: Array<{ label: string; amountCents: number; recurring: boolean }>;
  supplies: string;
  equipment: string;
  crewRequirements: string;
  scheduleNotes: string;
  exclusions: string;
}

interface CommercialState {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
  contracts: Array<Record<string, unknown>>;
  editingId: string;
  editingProposal: Record<string, unknown> | null;
  scope: CommercialScope;
  propertyId: string;
}

function escUi(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function moneyUi(value: unknown): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(value ?? 0) / 100,
  );
}

function titleUi(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyUi(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function localTodayUi(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function emptyCommercialScope(): CommercialScope {
  return {
    locations: [],
    oneTimeCharges: [],
    addOns: [],
    supplies: '',
    equipment: '',
    crewRequirements: '',
    scheduleNotes: '',
    exclusions: '',
  };
}

interface CommercialScheduleContext {
  contractId: string;
  contract: Record<string, unknown>;
  properties: Array<Record<string, unknown>>;
  defaults: Record<string, { scopeNotes: string; accessInstructions: string }>;
  schedules: Array<Record<string, unknown>>;
}

let commercialScheduleState: CommercialScheduleContext | null = null;

let commercialState: CommercialState = {
  customers: [],
  properties: [],
  proposals: [],
  contracts: [],
  editingId: '',
  editingProposal: null,
  scope: emptyCommercialScope(),
  propertyId: '',
};

function commercialSetStatus(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const target = document.querySelector<HTMLElement>('[data-commercial-status]');
  if (!target) return;
  target.textContent = message;
  target.dataset.state = kind;
}

async function commercialApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const csrf = (window as unknown as { __ssAdminCsrf?: string }).__ssAdminCsrf ?? '';
  if (csrf && init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrf);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const data = (await response.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
    details?: string[];
  };
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `HTTP ${response.status}`) as Error & {
      details?: string[];
    };
    error.details = Array.isArray(data.details) ? data.details : [];
    throw error;
  }
  return data;
}

async function commercialPost(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return commercialApi<Record<string, unknown>>('/api/admin/commercial', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function commercialCustomerLabel(customer: Record<string, unknown>): string {
  return (
    String(customer.company_name ?? '').trim() ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
    String(customer.id ?? '')
  );
}

function commercialPropertyLabel(property: Record<string, unknown>): string {
  return (
    [property.label, property.line1, property.city, property.state].filter(Boolean).join(', ') ||
    String(property.id ?? '')
  );
}

function commercialDollars(value: unknown): string {
  return (Number(value ?? 0) / 100).toFixed(2);
}

export async function loadCommercial(): Promise<void> {
  commercialSetStatus('Loading commercial accounts…');
  const data = await commercialApi<{
    customers?: Array<Record<string, unknown>>;
    properties?: Array<Record<string, unknown>>;
    proposals?: Array<Record<string, unknown>>;
    contracts?: Array<Record<string, unknown>>;
  }>('/api/admin/commercial');
  commercialState = {
    ...commercialState,
    customers: data.customers ?? [],
    properties: data.properties ?? [],
    proposals: data.proposals ?? [],
    contracts: data.contracts ?? [],
    editingId: '',
    editingProposal: null,
  };
  commercialSetStatus('');
  renderCommercial();
}

function commercialPropOptions(selected: string, customerId: string): string {
  const properties = commercialState.properties.filter(
    (property) => !customerId || String(property.customer_id) === customerId,
  );
  return `<option value="">No specific facility</option>${properties
    .map(
      (property) =>
        `<option value="${escUi(property.id)}"${String(property.id) === selected ? ' selected' : ''}>${escUi(commercialPropertyLabel(property))}</option>`,
    )
    .join('')}`;
}

function renderCommercial(): void {
  const target = document.querySelector<HTMLElement>('[data-commercial-workspace]');
  if (!target) return;
  const proposalRows = commercialState.proposals
    .map((proposal) => {
      const customer =
        [proposal.first_name, proposal.last_name].filter(Boolean).join(' ') ||
        proposal.company_name ||
        'Customer';
      const status = String(proposal.status ?? 'draft');
      const actions = [
        `<button class="btn btn--ghost btn--small" type="button" data-commercial-action="edit" data-id="${escUi(proposal.id)}">Open</button>`,
        status === 'draft'
          ? `<button class="btn btn--secondary btn--small" type="button" data-commercial-action="publish" data-id="${escUi(proposal.id)}">Publish</button>`
          : '',
        status === 'published' || status === 'sent'
          ? `<button class="btn btn--primary btn--small" type="button" data-commercial-action="send" data-id="${escUi(proposal.id)}">Send for signature</button>`
          : '',
        status === 'accepted' && !proposal.contract_id
          ? `<button class="btn btn--secondary btn--small" type="button" data-commercial-action="contract" data-id="${escUi(proposal.id)}">Create contract</button>`
          : '',
        proposal.contract_id
          ? `<button class="btn btn--ghost btn--small" type="button" data-commercial-action="open-contract" data-id="${escUi(proposal.contract_id)}">Contract</button>`
          : '',
        status !== 'accepted' && status !== 'archived'
          ? `<button class="btn btn--ghost btn--small" type="button" data-commercial-action="archive" data-id="${escUi(proposal.id)}">Archive</button>`
          : '',
      ]
        .filter(Boolean)
        .join('');
      return `<tr>
        <td>${escUi(proposal.proposal_number)}<br /><span class="admin-muted">${escUi(proposal.title)}</span></td>
        <td>${escUi(customer)}<br /><span class="admin-muted">${escUi(proposal.property_label || proposal.line1 || '')}</span></td>
        <td><span class="admin-status">${escUi(titleUi(status))}</span></td>
        <td>${escUi(moneyUi(proposal.recurring_total_cents))}<br /><span class="admin-muted">first ${escUi(moneyUi(proposal.first_invoice_total_cents))}</span></td>
        <td>${escUi(proposal.expiration_date || '—')}</td>
        <td><div class="admin-actions">${actions || '<span class="admin-muted">No action</span>'}</div></td>
      </tr>`;
    })
    .join('');
  const contractRows = commercialState.contracts
    .map((contract) => {
      const customer =
        [contract.first_name, contract.last_name].filter(Boolean).join(' ') ||
        contract.company_name ||
        'Customer';
      return `<tr>
        <td>${escUi(customer)}<br /><span class="admin-muted">${escUi(contract.property_label || contract.line1 || '')}</span></td>
        <td>${escUi(titleUi(String(contract.status ?? '')))}</td>
        <td>${escUi(titleUi(String(contract.billing_frequency ?? '')))} · ${escUi(contract.payment_terms)}</td>
        <td>${escUi(moneyUi(contract.recurring_total_cents))}</td>
        <td>${escUi(contract.next_invoice_date || '—')} <span class="admin-muted">(${escUi(contract.invoice_count ?? 0)} billed)</span></td>
        <td><div class="admin-actions">
          <button class="btn btn--secondary btn--small" type="button" data-commercial-action="schedule" data-id="${escUi(contract.id)}">Service schedule</button>
          <button class="btn btn--primary btn--small" type="button" data-commercial-action="invoice" data-id="${escUi(contract.id)}">Generate invoice</button>
        </div></td>
      </tr>`;
    })
    .join('');
  const accountOptions = commercialState.customers
    .map(
      (customer) =>
        `<option value="${escUi(customer.id)}">${escUi(commercialCustomerLabel(customer))}</option>`,
    )
    .join('');
  const propertyCards = commercialState.properties
    .map((property) => {
      const customer = commercialState.customers.find(
        (entry) => entry.id === property.customer_id,
      );
      return `<div class="admin-record">
        <p><strong>${escUi(commercialPropertyLabel(property))}</strong></p>
        <p class="admin-muted">${escUi(customer ? commercialCustomerLabel(customer) : 'Unlinked customer')} · ${escUi(property.access_notes || 'No access instructions recorded')}</p>
        <button class="btn btn--ghost btn--small" type="button" data-commercial-action="property" data-id="${escUi(property.id)}">Contacts & walkthroughs</button>
      </div>`;
    })
    .join('');
  target.innerHTML = `
    <div class="admin-card">
      <h3>Proposals</h3>
      ${
        commercialState.proposals.length
          ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Proposal</th><th>Customer / facility</th><th>Status</th><th>Recurring / first invoice</th><th>Expires</th><th>Actions</th></tr></thead><tbody>${proposalRows}</tbody></table></div>`
          : '<p class="admin-muted">No commercial proposals yet.</p>'
      }
    </div>
    <div class="admin-card" style="margin-top:1rem;">
      <h3>Contracts and billing</h3>
      ${
        commercialState.contracts.length
          ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Customer / facility</th><th>Status</th><th>Billing / terms</th><th>Recurring</th><th>Next invoice</th><th>Action</th></tr></thead><tbody>${contractRows}</tbody></table></div>`
          : '<p class="admin-muted">No commercial contracts yet. A contract is created from an accepted proposal.</p>'
      }
    </div>
    <div class="admin-card" style="margin-top:1rem;">
      <h3>Facilities and account contacts</h3>
      <p class="admin-muted">Billing and facility contacts, access instructions and walkthrough records. Customers can have multiple facilities.</p>
      <label>Choose a customer to begin a proposal <select data-commercial-customer-filter><option value="">All customers</option>${accountOptions}</select></label>
      <div class="admin-actions"><button class="btn btn--primary btn--small" type="button" data-commercial-action="new-for-customer">New proposal for selected customer</button></div>
      <div class="admin-history" style="margin-top:.75rem;">${propertyCards || '<p class="admin-muted">No active facilities.</p>'}</div>
      <div data-commercial-property-panel style="margin-top:1rem;"></div>
    </div>
    <div data-commercial-schedule-panel style="margin-top:1rem;"></div>
    <div data-commercial-editor style="margin-top:1rem;"></div>`;
  if (commercialState.editingId) void renderCommercialEditor();
}

function commercialScopeFromProposal(proposal: Record<string, unknown>): CommercialScope {
  const scope = (proposal.scope ?? {}) as Partial<CommercialScope>;
  return {
    locations: Array.isArray(scope.locations) ? scope.locations : [],
    oneTimeCharges: Array.isArray(scope.oneTimeCharges) ? scope.oneTimeCharges : [],
    addOns: Array.isArray(scope.addOns) ? scope.addOns : [],
    supplies: String(scope.supplies ?? ''),
    equipment: String(scope.equipment ?? ''),
    crewRequirements: String(scope.crewRequirements ?? ''),
    scheduleNotes: String(scope.scheduleNotes ?? ''),
    exclusions: String(scope.exclusions ?? ''),
  };
}

function commercialTaskRow(
  taskIndex: number,
  task: { name: string; frequency: string; monthlyCents: number },
): string {
  return `<tr data-commercial-task data-task-index="${taskIndex}">
    <td><input data-task-field="name" value="${escUi(task.name)}" placeholder="Task" /></td>
    <td><input data-task-field="frequency" value="${escUi(task.frequency)}" placeholder="e.g. 3x weekly" /></td>
    <td><input data-task-field="monthly" type="number" min="0" step="0.01" value="${escUi(commercialDollars(task.monthlyCents))}" /></td>
    <td><button class="btn btn--ghost btn--small" type="button" data-commercial-action="remove-task" data-task="${taskIndex}">Remove</button></td>
  </tr>`;
}

function commercialAreaBlock(
  areaIndex: number,
  area: { name: string; notes: string; tasks: Array<{ name: string; frequency: string; monthlyCents: number }> },
): string {
  const rows = area.tasks
    .map((task, taskIndex) => commercialTaskRow(taskIndex, task))
    .join('');
  return `<div class="admin-record" data-commercial-area data-area-index="${areaIndex}">
    <div class="admin-form admin-form--grid">
      <label>Area / room group <input data-area-field="name" value="${escUi(area.name)}" placeholder="Offices, restrooms, lobby" /></label>
      <label>Area notes <input data-area-field="notes" value="${escUi(area.notes)}" /></label>
    </div>
    <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Task</th><th>Frequency</th><th>Price / period</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-commercial-action="add-task">Add task</button><button class="btn btn--ghost btn--small" type="button" data-commercial-action="remove-area">Remove area</button></div>
  </div>`;
}

function commercialLocationBlock(
  location: CommercialScope['locations'][number],
): string {
  const areas = location.areas
    .map((area, areaIndex) => commercialAreaBlock(areaIndex, area))
    .join('');
  return `<div class="admin-record" data-commercial-location>
    <div class="admin-form admin-form--grid">
      <label>Facility <select data-location-field="propertyId">${commercialPropOptions(location.propertyId, String(commercialState.editingProposal?.customer_id ?? ''))}</select></label>
      <label>Location name <input data-location-field="name" value="${escUi(location.name)}" placeholder="Facility or site name" /></label>
      <label>Address / instructions <input data-location-field="address" value="${escUi(location.address)}" /></label>
      <label>Location notes <input data-location-field="notes" value="${escUi(location.notes)}" /></label>
    </div>
    ${areas}
    <div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-commercial-action="add-area">Add area</button><button class="btn btn--ghost btn--small" type="button" data-commercial-action="remove-location">Remove location</button></div>
  </div>`;
}

function commercialChargeRow(
  index: number,
  charge: { label: string; amountCents: number },
): string {
  return `<tr data-commercial-charge data-charge-index="${index}"><td><input data-charge-field="label" value="${escUi(charge.label)}" placeholder="Charge description" /></td><td><input data-charge-field="amount" type="number" min="0" step="0.01" value="${escUi(commercialDollars(charge.amountCents))}" /></td><td><button class="btn btn--ghost btn--small" type="button" data-commercial-action="remove-charge" data-charge="${index}">Remove</button></td></tr>`;
}

async function renderCommercialEditor(): Promise<void> {
  const target = document.querySelector<HTMLElement>('[data-commercial-editor]');
  if (!target) return;
  const proposal = commercialState.editingProposal;
  const scope = commercialState.scope;
  const locations = scope.locations.map(commercialLocationBlock).join('');
  const charges = scope.oneTimeCharges
    .map((charge, index) => commercialChargeRow(index, charge))
    .join('');
  const addOns = scope.addOns
    .map(
      (addOn, index) =>
        `<tr data-commercial-addon data-addon-index="${index}"><td><input data-addon-field="label" value="${escUi(addOn.label)}" /></td><td><input data-addon-field="amount" type="number" min="0" step="0.01" value="${escUi(commercialDollars(addOn.amountCents))}" /></td><td><label><input type="checkbox" data-addon-field="recurring"${addOn.recurring ? ' checked' : ''} /> Recurring</label></td><td><button class="btn btn--ghost btn--small" type="button" data-commercial-action="remove-addon" data-addon="${index}">Remove</button></td></tr>`,
    )
    .join('');
  const customerOptions = commercialState.customers
    .map(
      (customer) =>
        `<option value="${escUi(customer.id)}"${String(proposal?.customer_id ?? '') === String(customer.id) ? ' selected' : ''}>${escUi(commercialCustomerLabel(customer))}</option>`,
    )
    .join('');
  const status = String(proposal?.status ?? 'draft');
  const revisionAllowed = Boolean(proposal) && status !== 'accepted' && status !== 'archived';
  target.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head"><h3>${proposal ? `Proposal ${escUi(proposal.proposal_number)} (v${escUi(proposal.version)})` : 'New commercial proposal'}</h3><div class="admin-actions">${commercialState.editingId ? '<button class="btn btn--secondary btn--small" type="button" data-commercial-action="preview">Preview / print</button>' : ''}<button class="btn btn--ghost btn--small" type="button" data-commercial-action="close-editor">Close</button></div></div>
    <div class="admin-form admin-form--grid">
      <label>Customer <select data-commercial-field="customerId"${commercialState.editingId ? ' disabled' : ''}><option value="">Choose a customer</option>${customerOptions}</select></label>
      <label>Primary facility <select data-commercial-field="propertyId">${commercialPropOptions(String(proposal?.property_id ?? ''), String(proposal?.customer_id ?? ''))}</select></label>
      <label>Proposal title <input data-commercial-field="title" value="${escUi(proposal?.title ?? '')}" placeholder="Commercial cleaning scope" /></label>
      <label>Billing frequency <select data-commercial-field="billingFrequency">${['monthly', 'quarterly', 'semiannual', 'annual', 'per_visit'].map((value) => `<option value="${value}"${String(proposal?.billing_frequency ?? 'monthly') === value ? ' selected' : ''}>${escUi(titleUi(value))}</option>`).join('')}</select></label>
      <label>Payment terms <input data-commercial-field="paymentTerms" value="${escUi(proposal?.payment_terms ?? 'Net 15')}" /></label>
      <label>Tax rate % <input data-commercial-field="taxRateBps" type="number" min="0" max="100" step="0.01" value="${escUi((Number(proposal?.tax_rate_bps ?? 0) / 100).toFixed(2))}" /></label>
      <label>Discount $ <input data-commercial-field="discount" type="number" min="0" step="0.01" value="${escUi(commercialDollars(proposal?.discount_cents ?? 0))}" /></label>
      <label>Expiration date <input data-commercial-field="expirationDate" type="date" value="${escUi(proposal?.expiration_date ?? '')}" /></label>
    </div>
    <label>Proposal introduction <textarea data-commercial-field="notes" rows="2">${escUi(proposal?.notes ?? '')}</textarea></label>
    <h4>Locations, areas and tasks</h4>
    <p class="admin-muted">Each task carries its own frequency and price per billing period. One-time charges are added separately. The server recalculates all totals.</p>
    ${locations || '<p class="admin-muted">Add the first facility location.</p>'}
    <div class="admin-actions"><button class="btn btn--secondary btn--small" type="button" data-commercial-action="add-location">Add location</button></div>
    <h4>One-time charges</h4>
    <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Description</th><th>Amount</th><th></th></tr></thead><tbody>${charges}</tbody></table></div>
    <div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-commercial-action="add-charge">Add one-time charge</button></div>
    <h4>Add-ons</h4>
    <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Add-on</th><th>Amount</th><th>Recurring</th><th></th></tr></thead><tbody>${addOns}</tbody></table></div>
    <div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-commercial-action="add-addon">Add add-on</button></div>
    <div class="admin-form admin-form--grid">
      <label>Supplies responsibility <input data-commercial-field="supplies" value="${escUi(scope.supplies)}" /></label>
      <label>Equipment responsibility <input data-commercial-field="equipment" value="${escUi(scope.equipment)}" /></label>
      <label>Crew requirements <input data-commercial-field="crewRequirements" value="${escUi(scope.crewRequirements)}" /></label>
      <label>Schedule notes <input data-commercial-field="scheduleNotes" value="${escUi(scope.scheduleNotes)}" /></label>
    </div>
    <label>Exclusions <textarea data-commercial-field="exclusions" rows="2">${escUi(scope.exclusions)}</textarea></label>
    <label>Terms and conditions <textarea data-commercial-field="terms" rows="4">${escUi(proposal?.terms ?? '')}</textarea></label>
    <div class="admin-actions">
      <button class="btn btn--primary btn--small" type="button" data-commercial-action="save">Save draft</button>
      <button class="btn btn--secondary btn--small" type="button" data-commercial-action="save-publish">Save and publish</button>
      ${revisionAllowed ? '<button class="btn btn--ghost btn--small" type="button" data-commercial-action="revision">Create revision</button>' : ''}
    </div>
  </div>`;
}

function collectCommercialScope(): CommercialScope {
  const scope = emptyCommercialScope();
  document.querySelectorAll<HTMLElement>('[data-commercial-location]').forEach((locationEl) => {
    const field = (name: string): string =>
      locationEl.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[data-location-field="${name}"]`,
      )?.value.trim() ?? '';
    const areas: CommercialScope['locations'][number]['areas'] = [];
    locationEl.querySelectorAll<HTMLElement>('[data-commercial-area]').forEach((areaEl) => {
      const areaField = (name: string): string =>
        areaEl.querySelector<HTMLInputElement>(`[data-area-field="${name}"]`)?.value.trim() ?? '';
      const tasks: Array<{ name: string; frequency: string; monthlyCents: number }> = [];
      areaEl.querySelectorAll<HTMLElement>('[data-commercial-task]').forEach((taskEl) => {
        const taskField = (name: string): string =>
          taskEl.querySelector<HTMLInputElement>(`[data-task-field="${name}"]`)?.value.trim() ?? '';
        const name = taskField('name');
        if (!name) return;
        tasks.push({
          name,
          frequency: taskField('frequency'),
          monthlyCents: Math.round(Number(taskField('monthly') || 0) * 100),
        });
      });
      areas.push({ name: areaField('name'), notes: areaField('notes'), tasks });
    });
    scope.locations.push({
      propertyId: field('propertyId'),
      name: field('name'),
      address: field('address'),
      notes: field('notes'),
      areas,
    });
  });
  document.querySelectorAll<HTMLElement>('[data-commercial-charge]').forEach((row) => {
    const label = row.querySelector<HTMLInputElement>('[data-charge-field="label"]')?.value.trim() ?? '';
    const amount = Math.round(
      Number(row.querySelector<HTMLInputElement>('[data-charge-field="amount"]')?.value ?? 0) * 100,
    );
    if (label || amount > 0) scope.oneTimeCharges.push({ label, amountCents: amount });
  });
  document.querySelectorAll<HTMLElement>('[data-commercial-addon]').forEach((row) => {
    const label = row.querySelector<HTMLInputElement>('[data-addon-field="label"]')?.value.trim() ?? '';
    const amount = Math.round(
      Number(row.querySelector<HTMLInputElement>('[data-addon-field="amount"]')?.value ?? 0) * 100,
    );
    const recurring = row.querySelector<HTMLInputElement>('[data-addon-field="recurring"]')?.checked ?? false;
    if (label || amount > 0) scope.addOns.push({ label, amountCents: amount, recurring });
  });
  const value = (name: string): string =>
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-commercial-field="${name}"]`,
    )?.value.trim() ?? '';
  scope.supplies = value('supplies');
  scope.equipment = value('equipment');
  scope.crewRequirements = value('crewRequirements');
  scope.scheduleNotes = value('scheduleNotes');
  scope.exclusions = value('exclusions');
  return scope;
}

function stashCommercialFields(): void {
  const value = (name: string): string =>
    document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-commercial-field="${name}"]`,
    )?.value.trim() ?? '';
  commercialState.editingProposal = {
    ...(commercialState.editingProposal ?? {}),
    customer_id: commercialState.editingProposal?.customer_id ?? value('customerId'),
    property_id: value('propertyId'),
    title: value('title'),
    billing_frequency: value('billingFrequency'),
    payment_terms: value('paymentTerms'),
    tax_rate_bps: Math.round(Number(value('taxRateBps') || 0) * 100),
    discount_cents: Math.round(Number(value('discount') || 0) * 100),
    expiration_date: value('expirationDate'),
    notes: value('notes'),
    terms: value('terms'),
  };
}

function commercialPayload(): Record<string, unknown> {
  const value = (name: string): string =>
    document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-commercial-field="${name}"]`,
    )?.value.trim() ?? '';
  return {
    customerId: commercialState.editingProposal?.customer_id ?? value('customerId'),
    propertyId: value('propertyId'),
    title: value('title'),
    billingFrequency: value('billingFrequency'),
    paymentTerms: value('paymentTerms'),
    taxRateBps: Math.round(Number(value('taxRateBps') || 0) * 100),
    discountCents: Math.round(Number(value('discount') || 0) * 100),
    expirationDate: value('expirationDate'),
    notes: value('notes'),
    terms: value('terms'),
    scope: collectCommercialScope(),
  };
}

async function openCommercialProposal(id: string): Promise<void> {
  const data = await commercialApi<{ proposal?: Record<string, unknown> }>(
    `/api/admin/commercial?view=proposal&id=${encodeURIComponent(id)}`,
  );
  const proposal = data.proposal ?? null;
  if (!proposal) throw new Error('proposal_not_found');
  commercialState.editingId = id;
  commercialState.editingProposal = proposal;
  commercialState.scope = commercialScopeFromProposal(proposal);
  await renderCommercialEditor();
}

async function saveCommercialProposal(publish: boolean): Promise<void> {
  const payload = commercialPayload();
  if (commercialState.editingId) {
    await commercialPost({ action: 'update_proposal', id: commercialState.editingId, ...payload });
    if (publish) await commercialPost({ action: 'publish_proposal', id: commercialState.editingId });
    commercialSetStatus(publish ? 'Proposal saved and published.' : 'Proposal saved as draft.', 'success');
    await loadCommercial();
    await openCommercialProposal(commercialState.editingId);
  } else {
    const created = await commercialPost({ action: 'create_proposal', ...payload });
    if (publish && created.id) await commercialPost({ action: 'publish_proposal', id: created.id });
    commercialSetStatus(publish ? 'Proposal created and published.' : 'Proposal created as draft.', 'success');
    await loadCommercial();
  }
}

async function openCommercialProperty(propertyId: string): Promise<void> {
  const panel = document.querySelector<HTMLElement>('[data-commercial-property-panel]');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-muted">Loading facility records…</p>';
  const data = await commercialApi<{
    contacts?: Array<Record<string, unknown>>;
    walkthroughs?: Array<Record<string, unknown>>;
  }>(`/api/admin/commercial?view=property&propertyId=${encodeURIComponent(propertyId)}`);
  const contacts = data.contacts ?? [];
  const walkthroughs = data.walkthroughs ?? [];
  panel.innerHTML = `<div class="admin-card">
    <h3>Facility records</h3>
    <h4>Billing and facility contacts</h4>
    ${contacts.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr></thead><tbody>${contacts.map((contact) => `<tr><td>${escUi(contact.name)}${Number(contact.is_primary) === 1 ? ' (primary)' : ''}</td><td>${escUi(titleUi(String(contact.role)))}</td><td>${escUi(contact.email || '—')}</td><td>${escUi(contact.phone || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="admin-muted">No facility contacts recorded.</p>'}
    <form class="admin-form admin-form--grid" data-commercial-contact-form>
      <input type="hidden" name="propertyId" value="${escUi(propertyId)}" />
      <label>Contact name <input name="name" required /></label>
      <label>Role <select name="role"><option value="billing">Billing</option><option value="facility" selected>Facility</option><option value="manager">Manager</option><option value="authorized">Authorized signer</option><option value="other">Other</option></select></label>
      <label>Email <input name="email" type="email" /></label>
      <label>Phone <input name="phone" /></label>
      <label><input type="checkbox" name="isPrimary" /> Primary contact</label>
      <button class="btn btn--secondary btn--small" type="submit">Add contact</button>
    </form>
    <h4>Walkthrough records</h4>
    ${walkthroughs.length ? `<div class="admin-history">${walkthroughs.map((entry) => `<div class="admin-record"><p><strong>${escUi(entry.walked_at)}</strong> · ${escUi(entry.attendees || 'Attendees not recorded')}</p><p class="admin-muted">${escUi(entry.findings || '')}</p><p class="admin-muted">${escUi(entry.scope_notes || '')}</p></div>`).join('')}</div>` : '<p class="admin-muted">No walkthroughs recorded.</p>'}
    <form class="admin-form admin-form--grid" data-commercial-walkthrough-form>
      <input type="hidden" name="propertyId" value="${escUi(propertyId)}" />
      <label>Walkthrough date <input name="walkedAt" type="date" value="${localTodayUi(0)}" required /></label>
      <label>Attendees <input name="attendees" /></label>
      <label class="admin-field--wide">Findings <textarea name="findings" rows="2"></textarea></label>
      <label class="admin-field--wide">Scope notes <textarea name="scopeNotes" rows="2"></textarea></label>
      <label class="admin-field--wide">Follow-up <textarea name="followUp" rows="2"></textarea></label>
      <button class="btn btn--secondary btn--small" type="submit">Record walkthrough</button>
    </form>
  </div>`;
}

async function openCommercialSchedule(contractId: string): Promise<void> {
  const panel = document.querySelector<HTMLElement>('[data-commercial-schedule-panel]');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-muted">Loading contract schedule...</p>';
  const data = await commercialApi<Omit<CommercialScheduleContext, 'contractId'>>(
    `/api/admin/commercial?view=contract_schedule&contractId=${encodeURIComponent(contractId)}`,
  );
  commercialScheduleState = { contractId, ...data };
  renderCommercialSchedule();
}

function scheduleTimeOptions(selected: string): string {
  const values: string[] = [];
  for (let minute = 7 * 60; minute <= 8 * 60 + 30; minute += 15) {
    values.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
  }
  for (let minute = 12 * 60 + 30; minute <= 14 * 60 + 30; minute += 15) {
    values.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
  }
  return values
    .map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${value}</option>`)
    .join('');
}

function renderCommercialSchedule(): void {
  const panel = document.querySelector<HTMLElement>('[data-commercial-schedule-panel]');
  const context = commercialScheduleState;
  if (!panel || !context) return;
  const contractStart = String(context.contract.start_date ?? '');
  const defaultStart =
    /^\d{4}-\d{2}-\d{2}$/.test(contractStart) && contractStart >= localTodayUi(0)
      ? contractStart
      : localTodayUi(1);
  const propertyOptions = context.properties
    .map(
      (property) =>
        `<option value="${escUi(property.id)}">${escUi(commercialPropertyLabel(property))}</option>`,
    )
    .join('');
  const defaultProperty = String(
    context.contract.property_id ?? context.properties[0]?.id ?? '',
  );
  const scheduleRows = context.schedules
    .map((schedule) => {
      const status = String(schedule.status ?? '');
      const actions = [
        status === 'active' || status === 'approved'
          ? `<button class="btn btn--ghost btn--small" type="button" data-commercial-schedule-action="pause" data-id="${escUi(schedule.id)}">Pause</button>`
          : '',
        status === 'paused'
          ? `<button class="btn btn--secondary btn--small" type="button" data-commercial-schedule-action="resume" data-id="${escUi(schedule.id)}">Resume</button>`
          : '',
        status !== 'cancelled'
          ? `<button class="btn btn--ghost btn--small" type="button" data-commercial-schedule-action="cancel" data-id="${escUi(schedule.id)}">Cancel</button>`
          : '',
      ]
        .filter(Boolean)
        .join('');
      return `<div class="admin-record">
        <p><strong>${escUi(schedule.property_label || schedule.line1 || 'Facility')}</strong> ${escUi(titleUi(status))}</p>
        <p class="admin-muted">${escUi(titleUi(String(schedule.frequency ?? '')))} - ${escUi(String(schedule.start_time ?? ''))} - ${escUi(String(schedule.crew_size ?? ''))} cleaner(s) - next ${escUi(schedule.next_visit_date || 'pending')} - ${escUi(schedule.scheduled_count ?? 0)} scheduled</p>
        <p class="admin-muted">Scope: ${escUi(schedule.scope_notes || 'not recorded')}</p>
        <p class="admin-muted">Access: ${escUi(schedule.access_instructions || 'not recorded')}</p>
        ${schedule.sync_error ? `<p class="admin-muted">Sync: ${escUi(schedule.sync_error)}</p>` : ''}
        <div class="admin-actions">
          ${actions}
          <button class="btn btn--ghost btn--small" type="button" data-commercial-schedule-nav="jobs">Open Job Files</button>
          <button class="btn btn--ghost btn--small" type="button" data-commercial-schedule-nav="recurring">Open Recurring Plans</button>
        </div>
      </div>`;
    })
    .join('');
  panel.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head"><h3>Commercial service schedule</h3><button class="btn btn--ghost btn--small" type="button" data-commercial-schedule-action="close">Close</button></div>
    <p class="admin-muted">Schedules are created only from structured, administrator-confirmed fields. Preview availability before approving; approving creates the recurring plan, Job Files and calendar events.</p>
    ${scheduleRows || '<p class="admin-muted">No service schedule exists for this contract.</p>'}
    <h4>Create or preview a service schedule</h4>
    <div class="admin-form admin-form--grid" data-commercial-schedule-form>
      <input type="hidden" data-schedule-field="contractId" value="${escUi(context.contractId)}" />
      <label>Facility <select data-schedule-field="propertyId">${propertyOptions}</select></label>
      <label>Frequency <select data-schedule-field="frequency"><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly" selected>Monthly</option></select></label>
      <label>First service date <input type="date" data-schedule-field="startDate" value="${defaultStart}" /></label>
      <label>Time window <select data-schedule-field="window"><option value="morning">Morning</option><option value="afternoon">Afternoon</option></select></label>
      <label>Start time <select data-schedule-field="startTime">${scheduleTimeOptions('08:00')}</select></label>
      <label>Visit minutes <input type="number" min="30" max="600" step="15" data-schedule-field="durationMinutes" value="120" /></label>
      <label>First visit minutes <input type="number" min="30" max="600" step="15" data-schedule-field="firstDurationMinutes" value="120" /></label>
      <label>Crew size <input type="number" min="1" max="6" data-schedule-field="crewSize" value="1" /></label>
      <label class="admin-field--wide">Facility scope <textarea rows="3" data-schedule-field="scopeNotes">${escUi(context.defaults[defaultProperty]?.scopeNotes ?? '')}</textarea></label>
      <label class="admin-field--wide">Customer access instructions <textarea rows="2" data-schedule-field="accessInstructions">${escUi(context.defaults[defaultProperty]?.accessInstructions ?? '')}</textarea></label>
      <label class="admin-field--wide">Required crew qualifications <input data-schedule-field="requiredQualifications" placeholder="e.g. floor scrubber certified, lead cleaner" /></label>
    </div>
    <div class="admin-actions">
      <button class="btn btn--secondary btn--small" type="button" data-commercial-schedule-action="preview">Preview availability</button>
      <button class="btn btn--primary btn--small" type="button" data-commercial-schedule-action="approve">Approve and generate schedule</button>
    </div>
    <div data-commercial-schedule-preview style="margin-top:.75rem;"></div>
  </div>`;
  const select = panel.querySelector<HTMLSelectElement>('[data-schedule-field="propertyId"]');
  if (select && defaultProperty) select.value = defaultProperty;
}

function scheduleField(name: string): string {
  return (
    document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-commercial-schedule-form] [data-schedule-field="${name}"]`,
    )?.value.trim() ?? ''
  );
}

function schedulePayload(): Record<string, unknown> {
  return {
    contractId: scheduleField('contractId'),
    propertyId: scheduleField('propertyId'),
    frequency: scheduleField('frequency'),
    startDate: scheduleField('startDate'),
    window: scheduleField('window'),
    startTime: scheduleField('startTime'),
    durationMinutes: Number(scheduleField('durationMinutes')),
    firstDurationMinutes: Number(scheduleField('firstDurationMinutes')),
    crewSize: Number(scheduleField('crewSize')),
    scopeNotes: scheduleField('scopeNotes'),
    accessInstructions: scheduleField('accessInstructions'),
    requiredQualifications: scheduleField('requiredQualifications'),
  };
}

function renderSchedulePreview(preview: Record<string, unknown>): void {
  const target = document.querySelector<HTMLElement>('[data-commercial-schedule-preview]');
  if (!target) return;
  const conflicts = (preview.conflicts as Array<Record<string, unknown>>) ?? [];
  const dates = (preview.dates as Array<Record<string, unknown>>) ?? [];
  target.innerHTML = `<div class="admin-record">
    <p><strong>${preview.ok ? 'Preview ready' : 'Conflicts found'}</strong></p>
    ${
      conflicts.length
        ? `<p class="admin-muted">${conflicts
            .slice(0, 12)
            .map((conflict) => `${escUi(conflict.date)}: ${escUi(titleUi(String(conflict.reason ?? '')))}`)
            .join('<br />')}</p>`
        : `<p class="admin-muted">${dates.length} visit(s) can be scheduled in the current booking window. First: ${escUi(dates[0]?.date ?? '')}.</p>`
    }
  </div>`;
}

async function previewCommercialScheduleUi(): Promise<void> {
  const result = await commercialPost({ action: 'preview_schedule', ...schedulePayload() });
  renderSchedulePreview((result.preview ?? {}) as Record<string, unknown>);
}

async function approveCommercialScheduleUi(): Promise<void> {
  if (!window.confirm('Approve this service schedule and create the recurring plan, Job Files and calendar events?')) {
    return;
  }
  const result = await commercialPost({ action: 'approve_schedule', ...schedulePayload() });
  commercialSetStatus(
    `Service schedule approved. ${String((result.sync as Record<string, unknown> | undefined)?.created ?? 0)} visit(s) created.`,
    'success',
  );
  const contractId = commercialScheduleState?.contractId ?? '';
  await loadCommercial();
  if (contractId) await openCommercialSchedule(contractId);
}

async function setCommercialScheduleStatusUi(
  scheduleId: string,
  status: 'active' | 'paused' | 'cancelled',
): Promise<void> {
  if (status === 'cancelled' && !window.confirm('Cancel this service schedule and its future visits?')) {
    return;
  }
  await commercialPost({ action: 'schedule_status', scheduleId, status });
  commercialSetStatus(`Service schedule ${status}.`, 'success');
  if (commercialScheduleState) await openCommercialSchedule(commercialScheduleState.contractId);
}

function commercialIndexFrom(target: HTMLElement | null, container: Element | null): number {
  if (!target || !container) return 0;
  const siblings = [...container.querySelectorAll(':scope > [data-commercial-location], :scope > [data-commercial-area], :scope > [data-commercial-task]')];
  return siblings.indexOf(target);
}

document.querySelector<HTMLElement>('[data-admin-view="commercial"]')?.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-commercial-action]');
  const action = target?.dataset.commercialAction ?? '';
  if (!action) return;
  const id = target?.dataset.id ?? '';
  const run = (work: Promise<unknown>): void => {
    work.catch((error) => commercialSetStatus(friendlyUi(error), 'error'));
  };
  if (action === 'refresh') run(loadCommercial());
  if (action === 'new') {
    commercialState.editingId = '';
    commercialState.editingProposal = null;
    commercialState.scope = emptyCommercialScope();
    void renderCommercialEditor();
  }
  if (action === 'new-for-customer') {
    const customerId =
      document.querySelector<HTMLSelectElement>('[data-commercial-customer-filter]')?.value ?? '';
    commercialState.editingId = '';
    commercialState.editingProposal = customerId
      ? { customer_id: customerId, property_id: '' }
      : null;
    commercialState.scope = emptyCommercialScope();
    void renderCommercialEditor();
  }
  if (action === 'edit') run(openCommercialProposal(id));
  if (action === 'preview') {
    window.open(
      `/api/admin/commercial?view=proposal_preview&id=${encodeURIComponent(commercialState.editingId)}`,
      '_blank',
      'noopener',
    );
  }
  if (action === 'close-editor') {
    commercialState.editingId = '';
    commercialState.editingProposal = null;
    const editor = document.querySelector<HTMLElement>('[data-commercial-editor]');
    if (editor) editor.innerHTML = '';
  }
  if (action === 'save' || action === 'save-publish') {
    commercialState.scope = collectCommercialScope();
    run(saveCommercialProposal(action === 'save-publish'));
  }
  if (action === 'add-location') {
    stashCommercialFields();
    commercialState.scope = collectCommercialScope();
    commercialState.scope.locations.push({ propertyId: '', name: '', address: '', notes: '', areas: [] });
    void renderCommercialEditor();
  }
  if (action === 'add-area' || action === 'remove-location' || action === 'add-task' || action === 'remove-area' || action === 'remove-task') {
    stashCommercialFields();
    commercialState.scope = collectCommercialScope();
    const locationEl = target?.closest<HTMLElement>('[data-commercial-location]') ?? null;
    const areaEl = target?.closest<HTMLElement>('[data-commercial-area]') ?? null;
    const taskEl = target?.closest<HTMLElement>('[data-commercial-task]') ?? null;
    const locationIndex = commercialIndexFrom(locationEl, locationEl?.parentElement ?? null);
    const areaIndex = commercialIndexFrom(areaEl, areaEl?.parentElement ?? null);
    const taskIndex = commercialIndexFrom(taskEl, taskEl?.parentElement ?? null);
    const location = commercialState.scope.locations[locationIndex];
    if (action === 'remove-location') commercialState.scope.locations.splice(locationIndex, 1);
    if (action === 'add-area') location?.areas.push({ name: '', notes: '', tasks: [] });
    if (action === 'remove-area') location?.areas.splice(areaIndex, 1);
    if (action === 'add-task') location?.areas[areaIndex]?.tasks.push({ name: '', frequency: '', monthlyCents: 0 });
    if (action === 'remove-task') location?.areas[areaIndex]?.tasks.splice(taskIndex, 1);
    void renderCommercialEditor();
  }
  if (action === 'add-charge' || action === 'remove-charge' || action === 'add-addon' || action === 'remove-addon') {
    stashCommercialFields();
    commercialState.scope = collectCommercialScope();
    if (action === 'add-charge') commercialState.scope.oneTimeCharges.push({ label: '', amountCents: 0 });
    if (action === 'remove-charge') commercialState.scope.oneTimeCharges.splice(Number(target?.dataset.charge ?? 0), 1);
    if (action === 'add-addon') commercialState.scope.addOns.push({ label: '', amountCents: 0, recurring: true });
    if (action === 'remove-addon') commercialState.scope.addOns.splice(Number(target?.dataset.addon ?? 0), 1);
    void renderCommercialEditor();
  }
  if (action === 'publish') {
    run(
      commercialPost({ action: 'publish_proposal', id }).then(() => {
        commercialSetStatus('Proposal published.', 'success');
        return loadCommercial();
      }),
    );
  }
  if (action === 'send') {
    if (!window.confirm('Send this proposal to the customer for electronic signature?')) return;
    run(
      commercialPost({ action: 'send_proposal', id }).then((result) => {
        commercialSetStatus(
          `Proposal sent for signature. Email: ${String(result.emailStatus ?? 'sent')}.`,
          'success',
        );
        return loadCommercial();
      }),
    );
  }
  if (action === 'revision') {
    run(
      commercialPost({ action: 'revision', id }).then((result) => {
        commercialSetStatus(`Revision v${String(result.version)} created.`, 'success');
        return openCommercialProposal(id);
      }),
    );
  }
  if (action === 'contract') {
    run(
      commercialPost({ action: 'create_contract', proposalId: id }).then(() => {
        commercialSetStatus('Commercial contract created.', 'success');
        return loadCommercial();
      }),
    );
  }
  if (action === 'invoice') {
    if (!window.confirm('Generate the next contract invoice for this billing period?')) return;
    run(
      commercialPost({ action: 'generate_invoice', contractId: id }).then((result) => {
        const invoice = (result.invoice ?? {}) as Record<string, unknown>;
        commercialSetStatus(
          `Invoice ${String(invoice.number)} created for ${moneyUi(invoice.totalCents)}.`,
          'success',
        );
        return loadCommercial();
      }),
    );
  }
  if (action === 'archive') {
    if (!window.confirm('Archive this proposal? It stays in history and cannot be edited.')) return;
    run(
      commercialPost({ action: 'archive_proposal', id }).then(() => {
        commercialSetStatus('Proposal archived.', 'success');
        return loadCommercial();
      }),
    );
  }
  if (action === 'property') run(openCommercialProperty(id));
  if (action === 'schedule' || action === 'open-contract') run(openCommercialSchedule(id));
});

document.querySelector<HTMLElement>('[data-admin-view="commercial"]')?.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-commercial-schedule-action], [data-commercial-schedule-nav]',
  );
  if (!target) return;
  const nav = target.dataset.commercialScheduleNav;
  if (nav) {
    window.dispatchEvent(new CustomEvent('ss-admin-navigate', { detail: { view: nav } }));
    return;
  }
  const action = target.dataset.commercialScheduleAction ?? '';
  const id = target.dataset.id ?? '';
  const run = (work: Promise<unknown>): void => {
    work.catch((error) => commercialSetStatus(friendlyUi(error), 'error'));
  };
  if (action === 'close') {
    commercialScheduleState = null;
    const panel = document.querySelector<HTMLElement>('[data-commercial-schedule-panel]');
    if (panel) panel.innerHTML = '';
  }
  if (action === 'preview') run(previewCommercialScheduleUi());
  if (action === 'approve') run(approveCommercialScheduleUi());
  if (action === 'pause') run(setCommercialScheduleStatusUi(id, 'paused'));
  if (action === 'resume') run(setCommercialScheduleStatusUi(id, 'active'));
  if (action === 'cancel') run(setCommercialScheduleStatusUi(id, 'cancelled'));
});

document.querySelector<HTMLElement>('[data-admin-view="commercial"]')?.addEventListener('change', (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>(
    '[data-schedule-field="propertyId"]',
  );
  if (!select || !commercialScheduleState) return;
  const defaults = commercialScheduleState.defaults[select.value];
  if (!defaults) return;
  const scope = document.querySelector<HTMLTextAreaElement>('[data-schedule-field="scopeNotes"]');
  const access = document.querySelector<HTMLTextAreaElement>(
    '[data-schedule-field="accessInstructions"]',
  );
  if (scope) scope.value = defaults.scopeNotes;
  if (access) access.value = defaults.accessInstructions;
});

document.querySelector<HTMLElement>('[data-admin-view="commercial"]')?.addEventListener('change', (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>(
    '[data-commercial-field="customerId"]',
  );
  if (!select) return;
  const property = document.querySelector<HTMLSelectElement>('[data-commercial-field="propertyId"]');
  if (property) property.innerHTML = commercialPropOptions('', select.value);
});

document.querySelector<HTMLElement>('[data-admin-view="commercial"]')?.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form.matches('[data-commercial-contact-form]')) {
    event.preventDefault();
    const data = new FormData(form);
    commercialPost({
      action: 'add_contact',
      propertyId: data.get('propertyId'),
      name: data.get('name'),
      role: data.get('role'),
      email: data.get('email'),
      phone: data.get('phone'),
      isPrimary: data.get('isPrimary') === 'on',
    })
      .then(() => {
        commercialSetStatus('Facility contact added.', 'success');
        return openCommercialProperty(String(data.get('propertyId')));
      })
      .catch((error) => commercialSetStatus(friendlyUi(error), 'error'));
  }
  if (form.matches('[data-commercial-walkthrough-form]')) {
    event.preventDefault();
    const data = new FormData(form);
    commercialPost({
      action: 'add_walkthrough',
      propertyId: data.get('propertyId'),
      walkedAt: data.get('walkedAt'),
      attendees: data.get('attendees'),
      findings: data.get('findings'),
      scopeNotes: data.get('scopeNotes'),
      followUp: data.get('followUp'),
    })
      .then(() => {
        commercialSetStatus('Walkthrough recorded.', 'success');
        return openCommercialProperty(String(data.get('propertyId')));
      })
      .catch((error) => commercialSetStatus(friendlyUi(error), 'error'));
  }
});

export async function openCommercialProposalFromCustomer(id: string): Promise<void> {
  await loadCommercial();
  await openCommercialProposal(id);
}
