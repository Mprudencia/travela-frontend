import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeReferral,
  REFERRAL_COOKIE,
  referralCookieOptions,
  resolveReferral,
} from '@/lib/referral-server';

function bundlesRedirect(unavailable = false) {
  // A relative Location keeps the browser on its public origin. Behind Nginx,
  // request.url can contain the upstream localhost address instead.
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: unavailable ? '/bundles?referral=unavailable' : '/bundles',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const code = normalizeReferral((await context.params).code);
  if (!code) return bundlesRedirect(true);
  try {
    const valid = await resolveReferral(code);
    const response = bundlesRedirect(!valid);
    if (valid) response.cookies.set(REFERRAL_COOKIE, valid, referralCookieOptions);
    return response;
  } catch {
    return new NextResponse(
      'We could not check this partner link. Please refresh and try again.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
