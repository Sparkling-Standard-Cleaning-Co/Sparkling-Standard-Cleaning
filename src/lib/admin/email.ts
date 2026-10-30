// Server-only administrative email delivery. Only the configured recovery
// address receives security links; message bodies contain no customer data.

export interface AdminEmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_SITE_URL?: string;
}

export interface AdminEmail {
  subject: string;
  html: string;
  text: string;
}

function siteUrl(env: AdminEmailEnv): string {
  return (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f8f1ec;color:#2c2421;font-family:Georgia,serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <p style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#9a5b61;margin:0 0 12px">Sparkling Standard</p>
    <h1 style="font-size:26px;line-height:1.2;margin:0 0 18px">${title}</h1>
    ${body}
    <p style="font-size:12px;color:#756963;margin-top:28px">If you did not request this, do not use the link and contact Sparkling Standard directly.</p>
  </div></body></html>`;
}

export function buildRecoveryEmail(env: AdminEmailEnv, token: string): AdminEmail {
  const url = `${siteUrl(env)}/gift-admin/?reset=${encodeURIComponent(token)}`;
  return {
    subject: 'Reset your Sparkling Standard gift administrator password',
    html: shell(
      'Reset your administrator password',
      `<p style="font-size:16px;line-height:1.6">A password reset was requested for the gift administrator account.</p>
       <p><a href="${url}" style="display:inline-block;background:#9a5b61;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Choose a new password</a></p>
       <p style="font-size:14px;line-height:1.6">This link expires in 30 minutes and can be used once.</p>`,
    ),
    text: `Reset your Sparkling Standard gift administrator password\n\n${url}\n\nThis link expires in 30 minutes and can be used once.`,
  };
}

export function buildVerifyEmail(env: AdminEmailEnv, token: string): AdminEmail {
  const url = `${siteUrl(env)}/gift-admin/?verify=${encodeURIComponent(token)}`;
  return {
    subject: 'Verify your gift administrator recovery email',
    html: shell(
      'Verify your recovery email',
      `<p style="font-size:16px;line-height:1.6">Confirm this address for gift administrator password recovery.</p>
       <p><a href="${url}" style="display:inline-block;background:#9a5b61;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Verify recovery email</a></p>
       <p style="font-size:14px;line-height:1.6">This link expires in 30 minutes and can be used once.</p>`,
    ),
    text: `Verify your Sparkling Standard gift administrator recovery email\n\n${url}\n\nThis link expires in 30 minutes and can be used once.`,
  };
}

export function buildPasswordChangedEmail(env: AdminEmailEnv): AdminEmail {
  const url = `${siteUrl(env)}/gift-admin/`;
  return {
    subject: 'Your Sparkling Standard gift administrator password was changed',
    html: shell(
      'Administrator password changed',
      `<p style="font-size:16px;line-height:1.6">The gift administrator password was changed. Existing sessions have been signed out.</p>
       <p><a href="${url}" style="color:#9a5b61">Open the gift administrator register</a></p>`,
    ),
    text: `The Sparkling Standard gift administrator password was changed. Existing sessions were signed out.\n\n${url}`,
  };
}

/**
 * Operations-console recovery email. The link opens the password-setting
 * interface directly; the token is single use and expires in 30 minutes.
 */
export function buildOpsPasswordResetEmail(env: AdminEmailEnv, token: string, name?: string): AdminEmail {
  const url = `${siteUrl(env)}/admin/?reset=${encodeURIComponent(token)}`;
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hello,';
  const plainGreeting = name ? `Hi ${name},` : 'Hello,';
  return {
    subject: 'Reset your Sparkling Standard administrator password',
    html: shell(
      'Reset your administrator password',
      `<p style="font-size:16px;line-height:1.6">${greeting}</p>
       <p style="font-size:16px;line-height:1.6">A password reset was requested for your Sparkling Standard Operations account.</p>
       <p><a href="${url}" style="display:inline-block;background:#9a5b61;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Choose a new password</a></p>
       <p style="font-size:14px;line-height:1.6">This link expires in 30 minutes and can be used once. Your two-step verification settings are not changed.</p>`,
    ),
    text: `Reset your Sparkling Standard administrator password\n\n${plainGreeting}\n\nChoose a new password (single use, expires in 30 minutes):\n${url}\n\nYour two-step verification settings are not changed.`,
  };
}

export function buildOpsPasswordChangedEmail(env: AdminEmailEnv, name?: string): AdminEmail {
  const url = `${siteUrl(env)}/admin/`;
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hello,';
  return {
    subject: 'Your Sparkling Standard administrator password was changed',
    html: shell(
      'Administrator password changed',
      `<p style="font-size:16px;line-height:1.6">${greeting}</p>
       <p style="font-size:16px;line-height:1.6">The password for your Sparkling Standard Operations account was changed. All existing sessions were signed out.</p>
       <p><a href="${url}" style="color:#9a5b61">Sign in to Operations</a></p>`,
    ),
    text: `Your Sparkling Standard administrator password was changed.\n\nAll existing sessions were signed out.\n\n${url}`,
  };
}

export function buildOpsInvitationEmail(env: AdminEmailEnv, token: string, role: string): AdminEmail {
  const url = `${siteUrl(env)}/admin/?invite=${encodeURIComponent(token)}`;
  return {
    subject: 'Sparkling Standard administrator invitation',
    html: shell(
      'You have been invited to Operations',
      `<p style="font-size:16px;line-height:1.6">You have been invited to the Sparkling Standard Operations console as <strong>${escapeHtml(role)}</strong>.</p>
       <p><a href="${url}" style="display:inline-block;background:#9a5b61;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Accept the invitation</a></p>
       <p style="font-size:14px;line-height:1.6">This link expires in 72 hours and can be used once. Choose a password of at least 8 characters including one special character.</p>`,
    ),
    text: `You have been invited to the Sparkling Standard Operations console as ${role}.\n\nAccept the invitation (single use, expires in 72 hours):\n${url}\n\nChoose a password of at least 8 characters including one special character.`,
  };
}

export async function sendAdminEmail(
  env: AdminEmailEnv,
  to: string,
  email: AdminEmail,
  idempotencyKey: string,
): Promise<boolean> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key || !to) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey.slice(0, 200),
      },
      body: JSON.stringify({
        from:
          env.RESEND_FROM_EMAIL?.trim() ||
          'Sparkling Standard <notifications@sparkling-standard.com>',
        ...(env.RESEND_REPLY_TO?.trim() ? { reply_to: env.RESEND_REPLY_TO.trim() } : {}),
        to: [to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
