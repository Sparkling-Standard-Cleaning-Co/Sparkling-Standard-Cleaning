// One-time owner helper: obtain a Google Calendar OAuth refresh token.
//
// Prerequisites:
//   1. Google Cloud project under the Sparkling Standard Google account.
//   2. Google Calendar API enabled.
//   3. OAuth consent screen configured; scope https://www.googleapis.com/auth/calendar
//   4. OAuth client (Desktop app is simplest; or Web app with the redirect URI below).
//
// Usage (PowerShell):
//   $env:GOOGLE_CLIENT_ID="..."
//   $env:GOOGLE_CLIENT_SECRET="..."
//   node scripts/google-calendar-auth.mjs
//
// The refresh token is printed once to this terminal. Never save it in the
// repository, a screenshot, chat or a committed .env file. Store it only in
// Cloudflare Pages as the GOOGLE_REFRESH_TOKEN secret.

import http from 'node:http';
import crypto from 'node:crypto';

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const port = Number(process.env.GOOGLE_AUTH_PORT ?? 53682);
const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || `http://localhost:${port}/oauth2callback`;
const scope = 'https://www.googleapis.com/auth/calendar';

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.');
  process.exit(1);
}

const state = crypto.randomBytes(24).toString('hex');
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', scope);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('state', state);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', redirectUri);
  if (url.pathname !== '/oauth2callback') {
    response.writeHead(404).end('Not found');
    return;
  }
  if (url.searchParams.get('state') !== state) {
    response.writeHead(400).end('State mismatch - close this tab and run the helper again.');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    response.writeHead(400).end('Google did not return an authorization code.');
    return;
  }
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !token.refresh_token) {
      response.writeHead(500).end('Token exchange failed. Check the terminal.');
      console.error('Token exchange failed:', token.error_description ?? tokenResponse.status);
      server.close();
      process.exitCode = 1;
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
      'Authorization complete. Return to the terminal, copy the refresh token into Cloudflare, then close this tab.',
    );
    console.log('\nGOOGLE_REFRESH_TOKEN (secret):');
    console.log(token.refresh_token);
    console.log('\nStore it only as a Cloudflare Pages secret. Then delete it from terminal history if applicable.');
  } catch (error) {
    response.writeHead(500).end('Token exchange failed. Check the terminal.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('Open this URL in the Sparkling Standard Google account and approve Calendar access:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for the Google redirect...');
});
