// Employee administration, onboarding, training, quality and payroll UI.

interface EmployeeState {
  profiles: Array<Record<string, unknown>>;
  modules: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  inspections: Array<Record<string, unknown>>;
  payroll: Array<Record<string, unknown>>;
  timeOff: Array<Record<string, unknown>>;
  selectedMember: string;
  memberData: {
    onboarding: Array<Record<string, unknown>>;
    training: Array<Record<string, unknown>>;
    performance: Array<Record<string, unknown>>;
    expirations: Array<Record<string, unknown>>;
    shifts: Array<Record<string, unknown>>;
  };
  payrollDetail: {
    period: Record<string, unknown>;
    entries: Array<Record<string, unknown>>;
    adjustments: Array<Record<string, unknown>>;
  } | null;
}

const employeeState: EmployeeState = {
  profiles: [],
  modules: [],
  assignments: [],
  inspections: [],
  payroll: [],
  timeOff: [],
  selectedMember: '',
  memberData: { onboarding: [], training: [], performance: [], expirations: [], shifts: [] },
  payrollDetail: null,
};

function escE(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function moneyE(value: unknown): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(value ?? 0) / 100,
  );
}

function titleE(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hoursE(minutes: unknown): string {
  return (Number(minutes ?? 0) / 60).toFixed(2);
}

function dateE(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function setEmployeeStatus(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const target = document.querySelector<HTMLElement>('[data-employees-status]');
  if (!target) return;
  target.textContent = message;
  target.dataset.state = kind;
}

async function employeeApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const csrf = (window as unknown as { __ssAdminCsrf?: string }).__ssAdminCsrf ?? '';
  if (csrf && init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrf);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function employeePost(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return employeeApi<Record<string, unknown>>('/api/admin/employees', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function employeeFailure(error: unknown): void {
  setEmployeeStatus(
    (error instanceof Error ? error.message : String(error)).replaceAll('_', ' '),
    'error',
  );
}

export async function loadEmployees(): Promise<void> {
  setEmployeeStatus('Loading employee records…');
  const data = await employeeApi<{
    profiles?: Array<Record<string, unknown>>;
    modules?: Array<Record<string, unknown>>;
    assignments?: Array<Record<string, unknown>>;
    inspections?: Array<Record<string, unknown>>;
    payroll?: Array<Record<string, unknown>>;
    timeOff?: Array<Record<string, unknown>>;
  }>('/api/admin/employees');
  employeeState.profiles = data.profiles ?? [];
  employeeState.modules = data.modules ?? [];
  employeeState.assignments = data.assignments ?? [];
  employeeState.inspections = data.inspections ?? [];
  employeeState.payroll = data.payroll ?? [];
  employeeState.timeOff = data.timeOff ?? [];
  setEmployeeStatus('');
  renderEmployees();
  if (employeeState.selectedMember) {
    await loadEmployeeMember(employeeState.selectedMember);
  }
}

async function loadEmployeeMember(memberId: string): Promise<void> {
  const data = await employeeApi<EmployeeState['memberData'] & { ok?: boolean }>(
    `/api/admin/employees?view=member&id=${encodeURIComponent(memberId)}`,
  );
  employeeState.selectedMember = memberId;
  employeeState.memberData = {
    onboarding: data.onboarding ?? [],
    training: data.training ?? [],
    performance: data.performance ?? [],
    expirations: data.expirations ?? [],
    shifts: data.shifts ?? [],
  };
  renderEmployeeMember();
}

function employeeOptions(selected = ''): string {
  return employeeState.profiles
    .map(
      (employee) =>
        `<option value="${escE(employee.id)}"${employee.id === selected ? ' selected' : ''}>${escE(employee.display_name)}</option>`,
    )
    .join('');
}

function moduleOptions(): string {
  return employeeState.modules
    .filter((module) => Number(module.active) === 1)
    .map(
      (module) =>
        `<option value="${escE(module.id)}">${escE(module.title)} (${escE(module.category)})</option>`,
    )
    .join('');
}

function renderEmployees(): void {
  const target = document.querySelector<HTMLElement>('[data-employees-workspace]');
  if (!target) return;
  const profileRows = employeeState.profiles
    .map((employee) => {
      const expiring = employee.license_expires_on || employee.work_authorization_expires_on;
      return `<tr>
        <td><button class="btn btn--ghost btn--small" type="button" data-employee-action="select" data-id="${escE(employee.id)}">${escE(employee.display_name)}</button><br /><span class="admin-muted">${escE(employee.email || '')}</span></td>
        <td>${escE(titleE(String(employee.status ?? '')))}${Number(employee.is_bookable) === 1 ? ' · bookable' : ' · not bookable'}</td>
        <td>${escE(titleE(String(employee.default_rate_type ?? 'regular')))} · ${escE(moneyE(employee.pay_rate_regular_cents))} / ${escE(moneyE(employee.pay_rate_lead_cents))} / ${escE(moneyE(employee.pay_rate_solo_cents))}</td>
        <td>${Number(employee.pending_onboarding ?? 0)} onboarding · ${Number(employee.pending_training ?? 0)} training</td>
        <td>${expiring ? escE(expiring) : '—'}${employee.handbook_acknowledged_at ? '' : '<br /><span class="admin-warning">Handbook not acknowledged</span>'}</td>
        <td><button class="btn btn--secondary btn--small" type="button" data-employee-action="select" data-id="${escE(employee.id)}">Open file</button></td>
      </tr>`;
    })
    .join('');
  const inspectionRows = employeeState.inspections
    .map(
      (inspection) => `<tr>
        <td>${escE(inspection.inspected_at)}</td>
        <td>${escE([inspection.first_name, inspection.last_name].filter(Boolean).join(' ') || inspection.company_name || 'Facility')}</td>
        <td>${inspection.score === null || inspection.score === undefined ? '—' : escE(inspection.score)}</td>
        <td>${escE(titleE(String(inspection.status ?? '')))}</td>
        <td>${escE(inspection.inspector_name || '')}</td>
      </tr>`,
    )
    .join('');
  const payrollRows = employeeState.payroll
    .map(
      (period) => `<tr>
        <td>${escE(period.period_start)} – ${escE(period.period_end)}</td>
        <td>${escE(titleE(String(period.status ?? '')))}</td>
        <td>${escE(period.employee_count ?? 0)}</td>
        <td>${escE(moneyE(period.gross_cents))}</td>
        <td><div class="admin-actions">
          <button class="btn btn--ghost btn--small" type="button" data-employee-action="payroll-open" data-id="${escE(period.id)}">Open</button>
          ${period.status === 'open' || period.status === 'calculated' ? `<button class="btn btn--secondary btn--small" type="button" data-employee-action="payroll-calc" data-id="${escE(period.id)}">Calculate</button>` : ''}
          ${period.status === 'calculated' ? `<button class="btn btn--primary btn--small" type="button" data-employee-action="payroll-approve" data-id="${escE(period.id)}">Approve</button>` : ''}
          ${period.status !== 'open' ? `<a class="btn btn--ghost btn--small" href="/api/admin/employees?view=payroll_csv&id=${encodeURIComponent(String(period.id))}">CSV</a>` : ''}
        </div></td>
      </tr>`,
    )
    .join('');
  target.innerHTML = `
    <div class="admin-card">
      <h3>Employee profiles</h3>
      ${profileRows ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Employee</th><th>Status</th><th>Rates (regular / lead / solo)</th><th>Outstanding</th><th>Compliance</th><th></th></tr></thead><tbody>${profileRows}</tbody></table></div>` : '<p class="admin-muted">No employee profiles.</p>'}
      <div data-employee-member style="margin-top:1rem;"></div>
    </div>
    <div class="admin-card" style="margin-top:1rem;">
      <h3>Training library</h3>
      <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Module</th><th>Category</th><th>Version</th><th>Required</th><th>Assigned</th></tr></thead><tbody>${employeeState.modules.map((module) => `<tr><td>${escE(module.title)}</td><td>${escE(module.category)}</td><td>${escE(module.version)}</td><td>${Number(module.required) === 1 ? 'Yes' : 'No'}</td><td>${employeeState.assignments.filter((assignment) => assignment.module_id === module.id && assignment.status === 'assigned').length}</td></tr>`).join('') || '<tr><td colspan="5" class="admin-muted">No training modules yet.</td></tr>'}</tbody></table></div>
      <form class="admin-form admin-form--grid" data-employee-form="module">
        <label>Title <input name="title" required /></label>
        <label>Category <input name="category" placeholder="Safety, procedures, service" /></label>
        <label>Version <input name="version" value="1.0" /></label>
        <label class="admin-field--wide">Training content <textarea name="contentText" rows="4" placeholder="Procedure, policy, demonstration steps"></textarea></label>
        <label><input type="checkbox" name="required" checked /> Required</label>
        <button class="btn btn--secondary btn--small" type="submit">Add module</button>
      </form>
      <form class="admin-inline-form" data-employee-form="assign">
        <label>Employee <select name="teamMemberId" required><option value="">Choose employee</option>${employeeOptions()}</select></label>
        <label>Module <select name="moduleId" required><option value="">Choose module</option>${moduleOptions()}</select></label>
        <button class="btn btn--secondary btn--small" type="submit">Assign training</button>
      </form>
    </div>
    <div class="admin-card" style="margin-top:1rem;">
      <h3>Quality inspections</h3>
      ${inspectionRows ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Date</th><th>Customer</th><th>Score</th><th>Status</th><th>Inspector</th></tr></thead><tbody>${inspectionRows}</tbody></table></div>` : '<p class="admin-muted">No inspections recorded.</p>'}
      <form class="admin-form admin-form--grid" data-employee-form="inspection">
        <label>Completed job ID <input name="appointmentId" placeholder="appt_…" /></label>
        <label>Inspected date <input name="inspectedAt" type="date" value="${dateE(0)}" required /></label>
        <label>Score 0–100 <input name="score" type="number" min="0" max="100" /></label>
        <label>Inspector <select name="inspectorTeamMemberId"><option value="">Unspecified</option>${employeeOptions()}</select></label>
        <label class="admin-field--wide">Findings <textarea name="findings" rows="2"></textarea></label>
        <label class="admin-field--wide">Corrective actions <textarea name="correctiveActions" rows="2"></textarea></label>
        <button class="btn btn--secondary btn--small" type="submit">Record inspection</button>
      </form>
    </div>
    <div class="admin-card" style="margin-top:1rem;">
      <h3>Time-off requests</h3>
      ${
        employeeState.timeOff.length
          ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Employee</th><th>Dates</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead><tbody>${employeeState.timeOff
              .map(
                (entry) => `<tr><td>${escE(entry.display_name)}</td><td>${escE(entry.start_at)} – ${escE(entry.end_at)}</td><td>${escE(entry.reason || '—')}</td><td>${escE(titleE(String(entry.status)))}</td><td>${entry.status === 'pending' ? `<button class="btn btn--secondary btn--small" type="button" data-employee-action="timeoff-approve" data-id="${escE(entry.id)}">Approve</button> <button class="btn btn--ghost btn--small" type="button" data-employee-action="timeoff-decline" data-id="${escE(entry.id)}">Decline</button>` : ''}</td></tr>`,
              )
              .join('')}</tbody></table></div>`
          : '<p class="admin-muted">No time-off requests.</p>'
      }
    </div>
    <div class="admin-card" style="margin-top:1rem;">
      <h3>Payroll calculation</h3>
      <p class="admin-muted">Gross wages from approved timekeeping intervals, overtime and adjustments. No disbursement is performed.</p>
      <form class="admin-inline-form" data-employee-form="payroll-period">
        <label>Period start <input name="periodStart" type="date" value="${dateE(-13)}" required /></label>
        <label>Period end <input name="periodEnd" type="date" value="${dateE(0)}" required /></label>
        <button class="btn btn--secondary btn--small" type="submit">Create payroll period</button>
      </form>
      ${payrollRows ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Period</th><th>Status</th><th>Employees</th><th>Gross</th><th>Actions</th></tr></thead><tbody>${payrollRows}</tbody></table></div>` : '<p class="admin-muted">No payroll periods yet.</p>'}
      <div data-employee-payroll-detail style="margin-top:1rem;"></div>
    </div>`;
  if (employeeState.selectedMember) renderEmployeeMember();
  if (employeeState.payrollDetail) renderPayrollDetail();
}

function renderEmployeeMember(): void {
  const target = document.querySelector<HTMLElement>('[data-employee-member]');
  if (!target) return;
  const member = employeeState.profiles.find((entry) => entry.id === employeeState.selectedMember);
  if (!member) {
    target.innerHTML = '';
    return;
  }
  const onboarding = employeeState.memberData.onboarding
    .map(
      (task) => `<tr><td>${escE(task.title)}</td><td>${escE(titleE(String(task.category)))}</td><td>${escE(titleE(String(task.status)))}</td><td>${task.due_date ? escE(task.due_date) : '—'}</td><td>${task.status !== 'completed' ? `<button class="btn btn--ghost btn--small" type="button" data-employee-action="onboarding-complete" data-id="${escE(task.id)}">Complete</button>` : ''}</td></tr>`,
    )
    .join('');
  const training = employeeState.memberData.training
    .map(
      (assignment) => `<tr><td>${escE(assignment.title)}</td><td>${escE(titleE(String(assignment.status)))}</td><td>${assignment.score ?? '—'}</td><td>${assignment.status === 'assigned' ? `<button class="btn btn--ghost btn--small" type="button" data-employee-action="training-complete" data-id="${escE(assignment.id)}">Complete</button>` : ''}</td></tr>`,
    )
    .join('');
  const performance = employeeState.memberData.performance
    .map(
      (note) => `<div class="admin-record"><p><strong>${escE(titleE(String(note.kind)))}</strong> · ${escE(note.created_at)}</p><p>${escE(note.note)}</p></div>`,
    )
    .join('');
  const expirations = employeeState.memberData.expirations
    .map((entry) => `<li>${escE(entry.label)}${entry.expires ? ` — expires ${escE(entry.expires)}` : ''}${entry.status ? ` — ${escE(entry.status)}` : ''}</li>`)
    .join('');
  target.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head"><h3>${escE(member.display_name)}</h3><button class="btn btn--ghost btn--small" type="button" data-employee-action="member-close">Close</button></div>
    <form class="admin-form admin-form--grid" data-employee-form="profile">
      <input type="hidden" name="teamMemberId" value="${escE(member.id)}" />
      <label>Name <input name="displayName" value="${escE(member.display_name)}" required /></label>
      <label>Email <input name="email" type="email" value="${escE(member.email)}" /></label>
      <label>Phone <input name="phone" value="${escE(member.phone)}" /></label>
      <label>Branch <select name="branchId"><option value="branch_pensacola"${member.branch_id === 'branch_pensacola' ? ' selected' : ''}>Pensacola</option><option value="branch_tampa"${member.branch_id === 'branch_tampa' ? ' selected' : ''}>Tampa</option></select></label>
      <label>Status <select name="status"><option value="active"${member.status === 'active' ? ' selected' : ''}>Active</option><option value="inactive"${member.status === 'inactive' ? ' selected' : ''}>Inactive</option></select></label>
      <label class="admin-field--wide">Qualifications (comma separated) <input name="dispatchServices" value="${escE(JSON.parse(String(member.dispatch_services_json ?? '[]')).join(', '))}" /></label>
      <label><input type="checkbox" name="isBookable"${Number(member.is_bookable) === 1 ? ' checked' : ''} /> Bookable</label>
      <label>Hire date <input name="hireDate" type="date" value="${escE(member.hire_date ?? '')}" /></label>
      <label>Emergency contact <input name="emergencyContactName" value="${escE(member.emergency_contact_name ?? '')}" /></label>
      <label>Emergency phone <input name="emergencyContactPhone" value="${escE(member.emergency_contact_phone ?? '')}" /></label>
      <label>License / certification expires <input name="licenseExpiresOn" type="date" value="${escE(member.license_expires_on ?? '')}" /></label>
      <label>Work authorization expires <input name="workAuthorizationExpiresOn" type="date" value="${escE(member.work_authorization_expires_on ?? '')}" /></label>
      <label>Regular rate $/hr <input name="payRateRegular" type="number" step="0.01" value="${(Number(member.pay_rate_regular_cents ?? 1800) / 100).toFixed(2)}" /></label>
      <label>Lead rate $/hr <input name="payRateLead" type="number" step="0.01" value="${(Number(member.pay_rate_lead_cents ?? 2200) / 100).toFixed(2)}" /></label>
      <label>Solo rate $/hr <input name="payRateSolo" type="number" step="0.01" value="${(Number(member.pay_rate_solo_cents ?? 2500) / 100).toFixed(2)}" /></label>
      <label>Default rate <select name="defaultRateType">${['regular', 'lead', 'solo'].map((value) => `<option value="${value}"${member.default_rate_type === value ? ' selected' : ''}>${titleE(value)}</option>`).join('')}</select></label>
      <label class="admin-field--wide">Personnel notes <textarea name="personnelNotes" rows="2">${escE(member.personnel_notes ?? '')}</textarea></label>
      <button class="btn btn--primary btn--small" type="submit">Save profile</button>
      ${!member.handbook_acknowledged_at ? '<button class="btn btn--secondary btn--small" type="button" data-employee-action="handbook" data-id="' + escE(member.id) + '">Record handbook acknowledgment</button>' : '<span class="admin-status">Handbook acknowledged</span>'}
    </form>
    <h4>Onboarding checklist</h4>
    ${onboarding ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Task</th><th>Category</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>${onboarding}</tbody></table></div>` : '<p class="admin-muted">No onboarding tasks.</p>'}
    <form class="admin-inline-form" data-employee-form="onboarding">
      <input type="hidden" name="teamMemberId" value="${escE(member.id)}" />
      <label>Task <input name="title" required /></label>
      <label>Due <input name="dueDate" type="date" /></label>
      <button class="btn btn--ghost btn--small" type="submit">Add onboarding task</button>
    </form>
    <h4>Training</h4>
    ${training ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Module</th><th>Status</th><th>Score</th><th></th></tr></thead><tbody>${training}</tbody></table></div>` : '<p class="admin-muted">No training assignments.</p>'}
    <h4>Shifts and availability exceptions</h4>
    ${
      employeeState.memberData.shifts.length
        ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Date</th><th>Window</th><th>Status</th><th>Note</th></tr></thead><tbody>${employeeState.memberData.shifts
            .map(
              (shift) => `<tr><td>${escE(shift.work_date)}</td><td>${escE(shift.start_time)}–${escE(shift.end_time)}</td><td>${Number(shift.available) === 1 ? 'Available' : 'Unavailable'}</td><td>${escE(shift.note || '')}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : '<p class="admin-muted">No shift overrides.</p>'
    }
    <form class="admin-inline-form" data-employee-form="shift">
      <input type="hidden" name="teamMemberId" value="${escE(member.id)}" />
      <label>Date <input name="workDate" type="date" required /></label>
      <label>Start <input name="startTime" type="time" required /></label>
      <label>End <input name="endTime" type="time" required /></label>
      <label><input type="checkbox" name="available" checked /> Available</label>
      <label>Note <input name="note" maxlength="500" /></label>
      <button class="btn btn--ghost btn--small" type="submit">Save shift</button>
    </form>
    <h4>Performance and quality</h4>
    ${performance || '<p class="admin-muted">No performance records.</p>'}
    <form class="admin-inline-form" data-employee-form="performance">
      <input type="hidden" name="teamMemberId" value="${escE(member.id)}" />
      <label>Kind <select name="kind"><option value="praise">Praise</option><option value="coaching">Coaching</option><option value="corrective">Corrective</option><option value="customer_feedback">Customer feedback</option><option value="review">Review</option></select></label>
      <label>Note <input name="note" required /></label>
      <button class="btn btn--ghost btn--small" type="submit">Add note</button>
    </form>
    <h4>Documents and expirations</h4>
    ${expirations ? `<ul>${expirations}</ul>` : '<p class="admin-muted">No expiring documents recorded.</p>'}
  </div>`;
}

function renderPayrollDetail(): void {
  const target = document.querySelector<HTMLElement>('[data-employee-payroll-detail]');
  if (!target || !employeeState.payrollDetail) return;
  const detail = employeeState.payrollDetail;
  const entries = detail.entries
    .map(
      (entry) => `<tr><td>${escE(entry.display_name)}</td><td>${hoursE(entry.regular_minutes)}</td><td>${hoursE(entry.overtime_minutes)}</td><td>${escE(moneyE(entry.regular_cents))}</td><td>${escE(moneyE(entry.overtime_cents))}</td><td>${escE(moneyE(entry.adjustments_cents))}</td><td>${escE(moneyE(entry.gross_cents))}</td></tr>`,
    )
    .join('');
  const adjustments = detail.adjustments
    .map(
      (adjustment) => `<li>${escE(adjustment.display_name)} — ${escE(adjustment.label)} (${escE(titleE(String(adjustment.kind)))}) ${escE(moneyE(adjustment.amount_cents))}</li>`,
    )
    .join('');
  target.innerHTML = `<div class="admin-card">
    <div class="admin-detail-head"><h3>Payroll ${escE(detail.period.period_start)} – ${escE(detail.period.period_end)}</h3><button class="btn btn--ghost btn--small" type="button" data-employee-action="payroll-close">Close</button></div>
    <p>Status: <strong>${escE(titleE(String(detail.period.status)))}</strong></p>
    ${entries ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>Employee</th><th>Regular hrs</th><th>Overtime hrs</th><th>Regular</th><th>Overtime</th><th>Adjustments</th><th>Gross</th></tr></thead><tbody>${entries}</tbody></table></div>` : '<p class="admin-muted">No calculated entries. Use Calculate on the period.</p>'}
    <h4>Adjustments</h4>
    ${adjustments ? `<ul>${adjustments}</ul>` : '<p class="admin-muted">No adjustments.</p>'}
    ${detail.period.status !== 'approved' ? `<form class="admin-inline-form" data-employee-form="payroll-adjustment">
      <input type="hidden" name="periodId" value="${escE(detail.period.id)}" />
      <label>Employee <select name="teamMemberId" required><option value="">Choose</option>${employeeOptions()}</select></label>
      <label>Kind <select name="kind"><option value="travel">Travel</option><option value="bonus">Bonus</option><option value="deduction">Deduction</option><option value="adjustment">Adjustment</option></select></label>
      <label>Label <input name="label" required /></label>
      <label>Amount $ <input name="amount" type="number" step="0.01" required /></label>
      <button class="btn btn--ghost btn--small" type="submit">Add adjustment</button>
    </form>` : '<p class="admin-muted">Approved periods are locked.</p>'}
  </div>`;
}

async function openPayroll(periodId: string): Promise<void> {
  const data = await employeeApi<{
    period: Record<string, unknown>;
    entries: Array<Record<string, unknown>>;
    adjustments: Array<Record<string, unknown>>;
  }>(`/api/admin/employees?view=payroll&id=${encodeURIComponent(periodId)}`);
  employeeState.payrollDetail = {
    period: data.period,
    entries: data.entries ?? [],
    adjustments: data.adjustments ?? [],
  };
  renderPayrollDetail();
}

document.querySelector<HTMLElement>('[data-admin-view="employees"]')?.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-employee-action]');
  if (!target) return;
  const action = target.dataset.employeeAction ?? '';
  const id = target.dataset.id ?? '';
  const run = (work: Promise<unknown>): void => {
    work.catch(employeeFailure);
  };
  if (action === 'refresh') run(loadEmployees());
  if (action === 'select') run(loadEmployeeMember(id));
  if (action === 'member-close') {
    employeeState.selectedMember = '';
    const panel = document.querySelector<HTMLElement>('[data-employee-member]');
    if (panel) panel.innerHTML = '';
  }
  if (action === 'handbook') {
    run(employeePost({ action: 'handbook', teamMemberId: id }).then(() => loadEmployees()));
  }
  if (action === 'onboarding-complete') {
    run(employeePost({ action: 'onboarding_status', taskId: id, status: 'completed' }).then(() => loadEmployeeMember(employeeState.selectedMember)));
  }
  if (action === 'training-complete') {
    const score = window.prompt('Assessment score (0–100, optional)', '');
    run(
      employeePost({
        action: 'complete_training',
        assignmentId: id,
        ...(score && Number.isFinite(Number(score)) ? { score: Number(score) } : {}),
      }).then(() => loadEmployeeMember(employeeState.selectedMember)),
    );
  }
  if (action === 'timeoff-approve' || action === 'timeoff-decline') {
    run(
      employeePost({
        action: 'time_off_review',
        requestId: id,
        status: action === 'timeoff-approve' ? 'approved' : 'declined',
      }).then(() => loadEmployees()),
    );
  }
  if (action === 'payroll-open') run(openPayroll(id));
  if (action === 'payroll-calc') {
    run(employeePost({ action: 'payroll_calculate', periodId: id }).then(() => loadEmployees()));
  }
  if (action === 'payroll-approve') {
    if (!window.confirm('Approve this payroll calculation? Approved entries are locked.')) return;
    run(employeePost({ action: 'payroll_approve', periodId: id }).then(() => loadEmployees()));
  }
  if (action === 'payroll-close') {
    employeeState.payrollDetail = null;
    const detail = document.querySelector<HTMLElement>('[data-employee-payroll-detail]');
    if (detail) detail.innerHTML = '';
  }
});

document.querySelector<HTMLElement>('[data-admin-view="employees"]')?.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  const kind = form.dataset.employeeForm;
  if (!kind) return;
  event.preventDefault();
  const data = new FormData(form);
  const payload: Record<string, unknown> = {};
  data.forEach((value, key) => {
    payload[key] = value;
  });
  for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    payload[checkbox.name] = checkbox.checked;
  }
  if (kind === 'profile') {
    employeePost({ action: 'update_profile', ...payload })
      .then(() => {
        setEmployeeStatus('Employee profile saved.', 'success');
        return loadEmployees();
      })
      .catch(employeeFailure);
  }
  if (kind === 'module') {
    employeePost({ action: 'create_module', ...payload })
      .then(() => {
        setEmployeeStatus('Training module created.', 'success');
        return loadEmployees();
      })
      .catch(employeeFailure);
  }
  if (kind === 'assign') {
    employeePost({ action: 'assign_training', moduleId: payload.moduleId, teamMemberId: payload.teamMemberId })
      .then(() => {
        setEmployeeStatus('Training assigned.', 'success');
        return loadEmployees();
      })
      .catch(employeeFailure);
  }
  if (kind === 'onboarding') {
    employeePost({ action: 'add_onboarding', ...payload })
      .then(() => loadEmployeeMember(String(payload.teamMemberId)))
      .catch(employeeFailure);
  }
  if (kind === 'performance') {
    employeePost({ action: 'add_performance', ...payload })
      .then(() => loadEmployeeMember(String(payload.teamMemberId)))
      .catch(employeeFailure);
  }
  if (kind === 'inspection') {
    employeePost({
      action: 'create_inspection',
      appointmentId: payload.appointmentId,
      inspectedAt: payload.inspectedAt,
      score: payload.score,
      inspectorTeamMemberId: payload.inspectorTeamMemberId,
      findings: payload.findings,
      correctiveActions: payload.correctiveActions,
    })
      .then(() => {
        setEmployeeStatus('Quality inspection recorded.', 'success');
        return loadEmployees();
      })
      .catch(employeeFailure);
  }
  if (kind === 'shift') {
    employeePost({
      action: 'set_shift',
      teamMemberId: payload.teamMemberId,
      workDate: payload.workDate,
      startTime: payload.startTime,
      endTime: payload.endTime,
      available: payload.available === true || payload.available === 'on',
      note: payload.note,
    })
      .then(() => loadEmployeeMember(String(payload.teamMemberId)))
      .catch(employeeFailure);
  }
  if (kind === 'payroll-period') {
    employeePost({ action: 'payroll_create', periodStart: payload.periodStart, periodEnd: payload.periodEnd })
      .then(() => {
        setEmployeeStatus('Payroll period created.', 'success');
        return loadEmployees();
      })
      .catch(employeeFailure);
  }
  if (kind === 'payroll-adjustment') {
    employeePost({
      action: 'payroll_adjustment',
      periodId: payload.periodId,
      teamMemberId: payload.teamMemberId,
      kind: payload.kind,
      label: payload.label,
      amountCents: Math.round(Number(payload.amount ?? 0) * 100),
    })
      .then(() => openPayroll(String(payload.periodId)))
      .catch(employeeFailure);
  }
});
