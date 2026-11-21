import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchRequest } from '../workers/backup-scheduler/src/index.ts';

test('the backup scheduler dispatches production-safe without changing branches', () => {
  const request = dispatchRequest({ GITHUB_DISPATCH_TOKEN: 'synthetic-token' });
  assert.ok(request);
  assert.equal(
    request.url,
    'https://api.github.com/repos/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/actions/workflows/backup.yml/dispatches',
  );
  const body = JSON.parse(String(request.init.body));
  assert.equal(body.ref, 'production-safe');
  assert.equal(body.return_run_details, true);
  assert.equal(String(request.init.headers.Authorization), 'Bearer synthetic-token');
  assert.equal(JSON.stringify(request).includes('synthetic-token'), true);
  assert.equal(dispatchRequest({}), null);
});
