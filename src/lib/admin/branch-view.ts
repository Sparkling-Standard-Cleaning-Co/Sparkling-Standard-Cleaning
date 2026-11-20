// Owner branch-view preference.
//
// This is a narrowing filter, never a privilege grant. A user with an assigned
// branch always keeps that branch; the cookie is honored only for an
// all-branch owner. An invalid/unknown value fails closed to All Branches.

import { branchConfig } from '../../config/branches.ts';

export const BRANCH_VIEW_COOKIE = 'ss_branch_view';

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function requestedBranchView(request: Request): string | null {
  const value = readCookie(request, BRANCH_VIEW_COOKIE);
  return value && branchConfig(value) ? value : null;
}

export function branchViewCookie(value: string | null, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  if (!value) {
    return `${BRANCH_VIEW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }
  return `${BRANCH_VIEW_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}
