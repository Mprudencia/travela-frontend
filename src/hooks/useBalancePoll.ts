'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { EsimsApi } from '@/lib/api';
import {
  clearBalancePoll,
  getBalancePollContext,
  initBalancePollFromUrl,
} from '@/lib/balance-poll';
import { dataMbFromBalanceStatusBody } from '@/lib/esim-balance';

const POLL_MS = 5000;
const MAX_POLL_MS = 10 * 60 * 1000;

type BalanceStatusResponse = {
  balance_ready?: boolean;
  poll_again?: boolean;
  data?: unknown;
};

export function useBalancePoll(options?: { onBalanceReady?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const onReadyRef = useRef(options?.onBalanceReady);
  onReadyRef.current = options?.onBalanceReady;

  const [context, setContext] = useState(() => {
    initBalancePollFromUrl();
    return getBalancePollContext();
  });

  const [confirmedDataMb, setConfirmedDataMb] = useState<number | null>(null);
  const [pollComplete, setPollComplete] = useState(false);
  const [isPolling, setIsPolling] = useState(Boolean(context));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromReturnUrl =
      params.get('await_balance') === '1' || params.has('purchased_mb');
    if (fromReturnUrl) {
      initBalancePollFromUrl();
    }
    const next = getBalancePollContext();
    if (next) {
      setContext(next);
      setIsPolling(true);
    }
    if (!fromReturnUrl) return;
    params.delete('await_balance');
    params.delete('msisdn');
    params.delete('purchased_mb');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname]);

  const pollEnabled = Boolean(context?.since) && !pollComplete;

  const pollOnce = useCallback(async () => {
    if (!context?.since) return true;

    const sinceMs = Date.parse(context.since);
    if (Number.isFinite(sinceMs) && Date.now() - sinceMs > MAX_POLL_MS) {
      setIsPolling(false);
      setPollComplete(true);
      return true;
    }

    try {
      const res = await EsimsApi.balanceStatus({
        since: context.since,
        msisdn: context.msisdn,
      });

      if (!res.ok) return false;

      const body = res.body as BalanceStatusResponse;
      if (!body.balance_ready) return false;

      setConfirmedDataMb(dataMbFromBalanceStatusBody(body));
      setPollComplete(true);
      clearBalancePoll();
      setContext(null);
      setIsPolling(false);
      onReadyRef.current?.();
      return true;
    } catch {
      return false;
    }
  }, [context]);

  useEffect(() => {
    if (!pollEnabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const run = async () => {
      const done = await pollOnce();
      if (done && timer) {
        clearInterval(timer);
      }
    };

    void run();
    timer = setInterval(() => {
      if (cancelled) return;
      void run();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [pollEnabled, pollOnce]);

  return {
    isPolling,
    confirmedDataMb,
  };
}
