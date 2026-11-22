import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/request-origin';
import {
  normalizeReferral,
  REFERRAL_COOKIE,
  referralCookieOptions,
  resolveReferral,
} from '@/lib/referral-server';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const code = normalizeReferral(request.cookies.get(REFERRAL_COOKIE)?.value);
  if (!code) return NextResponse.json({ referral: null }, { headers });
  try {
    const valid = await resolveReferral(code);
    return NextResponse.json(
      valid
        ? { referral: { code: valid } }
        : {
            referral: { code },
            message:
              'This partner code is no longer available. Remove it or use another code.',
          },
      { status: valid ? 200 : 422, headers }
    );
  } catch {
    return NextResponse.json(
      { message: 'Could not check your partner code. Try again or remove it.' },
      { status: 503, headers }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({}, { status: 403, headers });
  try {
    if (Number(request.headers.get('content-length')) > 1024) {
      return NextResponse.json({}, { status: 413, headers });
    }
    const raw = await request.text();
    if (raw.length > 1024) return NextResponse.json({}, { status: 413, headers });
    const code = normalizeReferral(JSON.parse(raw)?.code);
    if (!code || !(await resolveReferral(code))) {
      return NextResponse.json(
        { message: 'Enter an active partner code.' },
        { status: 422, headers }
      );
    }
    const response = NextResponse.json({ referral: { code } }, { headers });
    response.cookies.set(REFERRAL_COOKIE, code, referralCookieOptions);
    return response;
  } catch {
    return NextResponse.json(
      { message: 'Could not check this code. Please try again.' },
      { status: 503, headers }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({}, { status: 403, headers });
  const response = NextResponse.json({ referral: null }, { headers });
  response.cookies.set(REFERRAL_COOKIE, '', { ...referralCookieOptions, maxAge: 0 });
  return response;
}
