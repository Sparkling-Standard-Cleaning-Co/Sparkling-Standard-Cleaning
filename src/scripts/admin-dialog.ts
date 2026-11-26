// Shared branded confirmation and input dialogs for the admin portal.
// The markup lives once in src/pages/admin/index.astro; modules only supply copy.

export interface AdminConfirmInput {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}

export interface AdminPromptInput extends AdminConfirmInput {
  label: string;
  type?: 'text' | 'password' | 'number';
  inputMode?: 'text' | 'numeric' | 'decimal';
  placeholder?: string;
  maxLength?: number;
  value?: string;
}

function dialogParts(): {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  body: HTMLElement;
  confirm: HTMLButtonElement;
  cancel: HTMLButtonElement;
} | null {
  const dialog = document.querySelector<HTMLDialogElement>('[data-admin-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') return null;
  const title = dialog.querySelector<HTMLElement>('[data-admin-dialog-title]');
  const body = dialog.querySelector<HTMLElement>('[data-admin-dialog-body]');
  const confirm = dialog.querySelector<HTMLButtonElement>('[data-admin-dialog-confirm]');
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-admin-dialog-cancel]');
  if (!title || !body || !confirm || !cancel) return null;
  return { dialog, title, body, confirm, cancel };
}

function prepare(
  parts: NonNullable<ReturnType<typeof dialogParts>>,
  input: AdminConfirmInput,
): void {
  parts.title.textContent = input.title;
  parts.body.innerHTML = input.body;
  parts.confirm.textContent = input.confirmLabel ?? 'Confirm';
  parts.confirm.classList.toggle('btn--danger', input.danger === true);
  parts.confirm.classList.toggle('btn--primary', input.danger !== true);
  parts.dialog.returnValue = 'cancel';
}

export function adminConfirm(input: AdminConfirmInput): Promise<boolean> {
  const parts = dialogParts();
  if (!parts) {
    console.error('Admin confirmation dialog markup is unavailable.');
    return Promise.resolve(false);
  }
  prepare(parts, input);
  const previousFocus = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    const onClose = (): void => {
      parts.dialog.removeEventListener('close', onClose);
      previousFocus?.focus?.();
      resolve(parts.dialog.returnValue === 'confirm');
    };
    parts.dialog.addEventListener('close', onClose);
    parts.dialog.showModal();
    parts.cancel.focus();
  });
}

export function adminPrompt(input: AdminPromptInput): Promise<string | null> {
  const parts = dialogParts();
  if (!parts) {
    console.error('Admin input dialog markup is unavailable.');
    return Promise.resolve(null);
  }
  const fieldId = `admin-dialog-input-${crypto.randomUUID()}`;
  prepare(parts, {
    ...input,
    body: `${input.body}<label class="admin-field--wide" style="display:block;margin-top:.75rem;">${input.label}
      <input id="${fieldId}" class="input" type="${input.type ?? 'text'}"${input.inputMode ? ` inputmode="${input.inputMode}"` : ''}${input.placeholder ? ` placeholder="${input.placeholder.replace(/"/g, '&quot;')}"` : ''}${input.maxLength ? ` maxlength="${input.maxLength}"` : ''} value="${String(input.value ?? '').replace(/"/g, '&quot;')}" />
    </label>`,
  });
  const field = parts.body.querySelector<HTMLInputElement>(`#${CSS.escape(fieldId)}`);
  const previousFocus = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    const onClose = (): void => {
      parts.dialog.removeEventListener('close', onClose);
      previousFocus?.focus?.();
      resolve(parts.dialog.returnValue === 'confirm' ? field?.value ?? '' : null);
    };
    parts.dialog.addEventListener('close', onClose);
    parts.dialog.showModal();
    field?.focus();
    field?.select?.();
  });
}
