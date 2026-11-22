'use client';

import { Calendar, Loader2 } from 'lucide-react';

const BRAND = {
  primary: '#112116',
  accent: '#17cf54',
  bg: '#f6f8f6',
  primarySoft: 'rgba(17,33,22,0.08)',
  accentSoft: 'rgba(23,207,84,0.15)',
};

type AssignSimPromptProps = {
  /** Formatted label for display, e.g. "Thu, 13 Aug 2026" */
  activationDateLabel: string | null;
  /** Current saved activation date as YYYY-MM-DD */
  currentActivationIso: string | null;
  saving: boolean;
  error: string;
  extendDate: string;
  minExtendDate: string;
  onExtendDateChange: (value: string) => void;
  /** Save a new activation date (when the picker differs from current). */
  onSaveDate: () => void;
  /** Confirm the current date — number assigns automatically. */
  onConfirm: () => void;
  onClose: () => void;
};

export default function AssignSimPrompt({
  activationDateLabel,
  currentActivationIso,
  saving,
  error,
  extendDate,
  minExtendDate,
  onExtendDateChange,
  onSaveDate,
  onConfirm,
  onClose,
}: AssignSimPromptProps) {
  const currentIso = (currentActivationIso ?? '').slice(0, 10);
  const hasDateChange = Boolean(extendDate && currentIso && extendDate !== currentIso);

  const handleCancel = () => {
    if (hasDateChange && currentIso) {
      onExtendDateChange(currentIso);
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/55"
      role="presentation"
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-sim-title"
      >
        <div className="px-5 pt-5 pb-6 sm:p-7">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}
          >
            <Calendar size={22} />
          </div>

          <h2
            id="assign-sim-title"
            className="text-xl font-extrabold text-slate-900 tracking-tight"
          >
            Confirm your activation date
          </h2>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            Your number will be assigned automatically. Confirm this date, or pick a later one if
            you need to travel later.
          </p>

          <div
            className="mt-5 rounded-2xl border border-slate-200 px-4 py-3.5"
            style={{ backgroundColor: BRAND.bg }}
          >
            <p
              className="text-[11px] font-bold uppercase tracking-widest"
              style={{ color: 'rgba(17,33,22,0.45)' }}
            >
              Current activation date
            </p>
            <p className="text-base font-extrabold mt-1" style={{ color: BRAND.primary }}>
              {activationDateLabel ?? currentIso ?? 'Not set'}
            </p>
          </div>

          <div className="mt-4">
            <label
              className="text-xs font-bold uppercase tracking-wide mb-1.5 block"
              style={{ color: BRAND.primary }}
            >
              Change activation date
            </label>
            <input
              type="date"
              min={minExtendDate}
              value={extendDate || currentIso}
              onChange={(e) => onExtendDateChange(e.target.value)}
              className="w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none transition-colors"
              style={{
                borderColor: hasDateChange ? BRAND.primary : undefined,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = BRAND.accent;
                e.currentTarget.style.boxShadow = `0 0 0 2px ${BRAND.accentSoft}`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = hasDateChange ? BRAND.primary : '#e2e8f0';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            {hasDateChange && (
              <p
                className="text-xs font-semibold mt-2 rounded-lg px-3 py-2"
                style={{ backgroundColor: BRAND.accentSoft, color: BRAND.primary }}
              >
                New date selected — tap Save date to update it.
              </p>
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm font-medium text-red-700">{error}</p>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={hasDateChange ? onSaveDate : onConfirm}
              disabled={saving || (hasDateChange && !extendDate)}
              className="w-full py-3.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: BRAND.primary }}
            >
              {saving ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> {hasDateChange ? 'Saving…' : 'Setting up…'}
                </span>
              ) : hasDateChange ? (
                'Save date'
              ) : (
                'Confirm date'
              )}
            </button>

            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="w-full py-3.5 rounded-xl text-sm font-bold bg-white disabled:opacity-60 transition-colors hover:bg-slate-50"
              style={{
                color: BRAND.primary,
                border: hasDateChange
                  ? `1.5px solid ${BRAND.primary}`
                  : '1.5px solid rgba(17,33,22,0.18)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
