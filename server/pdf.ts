import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export async function sealPdfWithSignature(input: {
  fileDataUrl: string;
  signatureDataUrl: string;
  title: string;
  signerName: string;
  signerEmail: string;
  documentHash: string;
  signedAt: string;
}) {
  const pdfBytes = dataUrlToBytes(input.fileDataUrl, 'data:application/pdf;base64,');
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];
  const { width } = page.getSize();
  const signatureImage = await pdfDoc.embedPng(dataUrlToBytes(input.signatureDataUrl, 'data:image/png;base64,'));
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const panelWidth = Math.min(width - 48, 520);
  const panelX = 24;
  const panelY = 24;

  page.drawRectangle({
    x: panelX,
    y: panelY,
    width: panelWidth,
    height: 116,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.09, 0.42, 0.53),
    borderWidth: 1.2,
    opacity: 0.96
  });
  page.drawText('Electronic signature', {
    x: panelX + 18,
    y: panelY + 92,
    size: 11,
    font: boldFont,
    color: rgb(0.05, 0.07, 0.09)
  });
  page.drawImage(signatureImage, {
    x: panelX + 18,
    y: panelY + 38,
    width: 152,
    height: 42
  });
  page.drawText(`Signer: ${input.signerName} <${input.signerEmail}>`, {
    x: panelX + 190,
    y: panelY + 68,
    size: 8.5,
    font: regularFont,
    color: rgb(0.16, 0.18, 0.22)
  });
  page.drawText(`Signed: ${input.signedAt}`, {
    x: panelX + 190,
    y: panelY + 51,
    size: 8.5,
    font: regularFont,
    color: rgb(0.16, 0.18, 0.22)
  });
  page.drawText(`Original SHA-256: ${input.documentHash.slice(0, 32)}...`, {
    x: panelX + 190,
    y: panelY + 34,
    size: 8.5,
    font: regularFont,
    color: rgb(0.16, 0.18, 0.22)
  });
  page.drawText(`Document: ${truncate(input.title, 55)}`, {
    x: panelX + 18,
    y: panelY + 15,
    size: 8.5,
    font: regularFont,
    color: rgb(0.16, 0.18, 0.22)
  });
  drawAuditCertificate(pdfDoc, {
    ...input,
    eventHash: createAuditEventHash(input)
  }, regularFont, boldFont);

  pdfDoc.setTitle(`${input.title} - signed`);
  pdfDoc.setSubject(`Signed electronically by ${input.signerName}`);
  pdfDoc.setProducer('Forg3 Sign');
  pdfDoc.setModificationDate(new Date(input.signedAt));

  const signedBytes = await pdfDoc.save();
  return `data:application/pdf;base64,${Buffer.from(signedBytes).toString('base64')}`;
}

function dataUrlToBytes(dataUrl: string, expectedPrefix: string) {
  if (!dataUrl.startsWith(expectedPrefix)) {
    throw new Error('Unexpected data URL format.');
  }

  return Buffer.from(dataUrl.slice(expectedPrefix.length), 'base64');
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function drawAuditCertificate(
  pdfDoc: PDFDocument,
  input: {
    title: string;
    signerName: string;
    signerEmail: string;
    documentHash: string;
    signedAt: string;
    eventHash: string;
  },
  regularFont: PDFFont,
  boldFont: PDFFont
) {
  const page = pdfDoc.addPage([612, 792]);
  const left = 54;
  let y = 724;

  page.drawText('Forg3 Sign Audit Certificate', {
    x: left,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0.05, 0.07, 0.09)
  });
  y -= 34;
  page.drawText('This certificate summarizes the electronic signature event recorded by Forg3 Sign.', {
    x: left,
    y,
    size: 10,
    font: regularFont,
    color: rgb(0.2, 0.24, 0.27)
  });
  y -= 34;

  const rows = [
    ['Document', input.title],
    ['Signer', `${input.signerName} <${input.signerEmail}>`],
    ['Signed at', input.signedAt],
    ['Original SHA-256', input.documentHash],
    ['Audit event hash', input.eventHash],
    ['Signature method', 'Drawn or typed electronic signature image sealed server-side'],
    ['Token status', 'Single-use signing token consumed after completion']
  ];

  for (const [label, value] of rows) {
    page.drawText(label, {
      x: left,
      y,
      size: 9,
      font: boldFont,
      color: rgb(0.09, 0.42, 0.53)
    });
    y -= 14;

    for (const line of wrapText(value, 86)) {
      page.drawText(line, {
        x: left + 18,
        y,
        size: 9,
        font: regularFont,
        color: rgb(0.16, 0.18, 0.22)
      });
      y -= 13;
    }

    y -= 9;
  }
}

function createAuditEventHash(input: {
  title: string;
  signerName: string;
  signerEmail: string;
  documentHash: string;
  signedAt: string;
}) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        title: input.title,
        signerName: input.signerName,
        signerEmail: input.signerEmail,
        documentHash: input.documentHash,
        signedAt: input.signedAt
      })
    )
    .digest('hex');
}

function wrapText(value: string, maxLength: number) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}
