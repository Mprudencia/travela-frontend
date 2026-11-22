'use client';

import { useEffect, useRef, useState } from 'react';
import { changeReferral } from '@/lib/referral-client';

/**
 * Partner code is entered once, then kept in a cookie for the rest of checkout.
 * When a code is already applied, only a compact confirmation is shown.
 */
export default function PartnerReferralField() {
  const [input, setInput] = useState('');
  const [applied, setApplied] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retryAction, setRetryAction] = useState<'load' | 'save'>('load');
  const changing = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/referral', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (controller.signal.aborted) return;
        const code = (data.referral?.code ?? '').replace(/^TRV-/, '');
        setInput(code);
        setApplied(code);
        setEditing(!code);
        setError(response.ok ? '' : data.message ?? 'Could not check your partner code.');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Could not check your partner code. Please retry.');
          setEditing(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  const save = async (code: string) => {
    if (changing.current) return;
    changing.current = true;
    setLoading(true);
    setError('');
    setRetryAction('save');
    try {
      const data = await changeReferral(code || null);
      const appliedCode = (data.referral?.code ?? '').replace(/^TRV-/, '');
      setApplied(appliedCode);
      setInput(appliedCode);
      setEditing(!appliedCode);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again.');
      setEditing(true);
    } finally {
      changing.current = false;
      setLoading(false);
    }
  };

  const editCode = (value: string) => {
    const code = value.trim().toUpperCase().replace(/^TRV-/, '');
    setInput(code);
    setError('');
    if (/^[A-Z0-9]{8}$/.test(code)) {
      if (code !== applied) void save(code);
    } else if (!code) {
      if (applied) void save('');
    }
  };

  if (!editing && applied && !error) {
    return (
      <section className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-5 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-slate-900">Partner code saved</p>
            <p role="status" className="text-xs text-emerald-800 mt-0.5">
              {applied} will be used for this purchase. You only need to enter it once.
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setEditing(true);
              setInput(applied);
            }}
            className="text-xs font-bold text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            Change
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
      <label htmlFor="partner-referral-code" className="text-sm font-bold text-slate-800">
        Partner referral code (optional)
      </label>
      <p id="partner-referral-help" className="mt-1 text-xs text-slate-500">
        Paste or type a code from your guide, hotel, or creator. Valid codes apply automatically and
        stay with you for this purchase.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          id="partner-referral-code"
          value={input}
          onChange={(event) => editCode(event.target.value)}
          maxLength={8}
          onPaste={(event) => {
            event.preventDefault();
            editCode(event.clipboardData.getData('text'));
          }}
          placeholder="XXXXXXXX"
          disabled={loading}
          aria-describedby="partner-referral-help"
          aria-invalid={Boolean(error)}
          autoCapitalize="characters"
          spellCheck={false}
          className="min-w-40 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm uppercase"
        />
        <button
          type="button"
          disabled={loading || (!applied && !input)}
          onClick={() => void save('')}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-50"
        >
          Remove
        </button>
      </div>
      {loading ? (
        <p role="status" className="mt-2 text-xs text-slate-500">
          Checking partner code…
        </p>
      ) : applied && input === applied && !error ? (
        <p role="status" className="mt-2 text-xs font-bold text-emerald-700">
          Referral code applied: {applied}
        </p>
      ) : input && !error ? (
        <p className="mt-2 text-xs text-slate-500">Enter the full 8-character referral code.</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}{' '}
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              if (retryAction === 'save') void save(input);
              else {
                setLoading(true);
                setAttempt((value) => value + 1);
              }
            }}
            className="font-bold underline"
          >
            Retry
          </button>
        </p>
      ) : null}
    </section>
  );
}
