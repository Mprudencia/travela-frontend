export default function NewEsimNotice() {
  return (
    <aside
      role="note"
      aria-label="New eSIM phone number"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
    >
      <p className="text-sm font-bold text-amber-950">New eSIM, new phone number</p>
      <p className="mt-1 text-sm leading-relaxed text-amber-900">
        Buying a new eSIM gives you a new phone number. To keep your current number, top up your
        existing eSIM within 30 days of activation.
      </p>
    </aside>
  );
}
