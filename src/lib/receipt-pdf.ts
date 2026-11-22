export type ReceiptPdfItem = {
  id: number;
  dataLabel: string;
  validityDays?: number | null;
  price: number;
  currency: string;
};

export type ReceiptPdfInput = {
  orderRef: string;
  paymentId: string;
  paidAtLabel: string;
  statusLabel: string;
  currency: string;
  total: number;
  vat: number;
  vatRatePercent: number;
  items: ReceiptPdfItem[];
  merchant: {
    legalName: string;
    brand: string;
    tin: string;
    address: string;
  };
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the browser has a chance to start the download
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/** Builds a Travela receipt PDF and downloads it directly through the browser. */
export async function downloadReceiptPdf(input: ReceiptPdfInput): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  let y = 56;

  const brand = '#112116';
  const muted = '#64748b';
  const ink = '#0f172a';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(brand);
  doc.text(input.merchant.brand, margin, y);

  y += 28;
  doc.setFontSize(22);
  doc.setTextColor(ink);
  doc.text('Receipt', margin, y);

  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(muted);
  doc.text(`${input.statusLabel} · ${input.paidAtLabel}`, margin, y);

  y += 28;
  doc.setDrawColor(226, 232, 240);
  doc.setLineDashPattern([3, 3], 0);
  doc.line(margin, y, margin + contentWidth, y);
  doc.setLineDashPattern([], 0);

  y += 22;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(ink);
  doc.text(input.merchant.legalName, margin, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(muted);
  doc.text(`TIN: ${input.merchant.tin}`, margin, y);
  y += 13;
  doc.text(input.merchant.address, margin, y);

  y += 24;
  doc.setDrawColor(226, 232, 240);
  doc.setLineDashPattern([3, 3], 0);
  doc.line(margin, y, margin + contentWidth, y);
  doc.setLineDashPattern([], 0);
  y += 20;

  if (input.items.length === 0) {
    doc.setTextColor(muted);
    doc.text('No line items on this order.', margin, y);
    y += 18;
  } else {
    for (const item of input.items) {
      const left = `Data ${item.dataLabel}${item.validityDays ? `, ${item.validityDays} days` : ''}`;
      const right = `${item.currency} ${item.price.toFixed(2)}`;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(ink);
      doc.text(left, margin, y);
      doc.text(right, margin + contentWidth, y, { align: 'right' });
      y += 18;
    }
  }

  y += 8;
  doc.setDrawColor(226, 232, 240);
  doc.setLineDashPattern([3, 3], 0);
  doc.line(margin, y, margin + contentWidth, y);
  doc.setLineDashPattern([], 0);
  y += 22;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(ink);
  doc.text('Total', margin, y);
  doc.setTextColor(brand);
  doc.text(`${input.currency} ${input.total.toFixed(2)}`, margin + contentWidth, y, {
    align: 'right',
  });

  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(muted);
  doc.text('Incl. VAT', margin, y);
  doc.text(`${input.currency} ${input.vat.toFixed(2)}`, margin + contentWidth, y, {
    align: 'right',
  });

  y += 14;
  doc.text('VAT rate', margin, y);
  doc.text(`${input.vatRatePercent.toFixed(0)}%`, margin + contentWidth, y, {
    align: 'right',
  });

  y += 24;
  doc.setDrawColor(226, 232, 240);
  doc.setLineDashPattern([3, 3], 0);
  doc.line(margin, y, margin + contentWidth, y);
  doc.setLineDashPattern([], 0);
  y += 20;

  doc.setFontSize(10);
  doc.setTextColor(muted);
  doc.text('Order ref', margin, y);
  doc.setTextColor(ink);
  doc.setFont('helvetica', 'bold');
  doc.text(input.orderRef, margin + contentWidth, y, { align: 'right' });

  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(muted);
  doc.text('Payment ID', margin, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(ink);
  doc.text(input.paymentId, margin + contentWidth, y, { align: 'right' });

  y += 36;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(muted);
  doc.text('Thank you for choosing Travela.', margin, y);

  const safeRef = input.orderRef.replace(/[^\w.-]+/g, '_').slice(0, 48) || 'order';
  const filename = `travela-receipt-${safeRef}.pdf`;
  const blob = doc.output('blob');

  triggerBlobDownload(blob, filename);
}
