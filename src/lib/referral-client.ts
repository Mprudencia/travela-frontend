type ReferralResult = { referral: { code: string } | null };
let pendingChange: Promise<ReferralResult> | null = null;

export function changeReferral(code: string | null): Promise<ReferralResult> {
  const operation = fetch('/api/referral', {
    method: code === null ? 'DELETE' : 'POST',
    ...(code === null
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }),
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? 'Could not update the code.');
    return data as ReferralResult;
  });
  pendingChange = operation;
  const clear = () => {
    if (pendingChange === operation) pendingChange = null;
  };
  void operation.then(clear, clear);
  return operation;
}

export async function waitForReferralChange(): Promise<void> {
  if (pendingChange) await pendingChange;
}
