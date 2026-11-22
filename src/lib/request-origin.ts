import type { NextRequest } from 'next/server';

/** Check the public request host; Next may normalize nextUrl to localhost in dev. */
export function isSameOriginRequest(request: Pick<NextRequest, 'headers' | 'nextUrl'>): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('host') ?? request.nextUrl.host;
    const expected = new URL(`${request.nextUrl.protocol}//${host}`);
    if (
      expected.username ||
      expected.password ||
      expected.pathname !== '/' ||
      expected.search ||
      expected.hash
    ) {
      return false;
    }
    return new URL(origin).origin === origin && origin === expected.origin;
  } catch {
    return false;
  }
}
