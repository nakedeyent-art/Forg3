import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

interface SealSignerInput {
  signerName: string;
  signerEmail: string;
  signatureDataUrl: string;
  signedAt: string;
  role?: string;
  identityVerificationStatus?: string;
}

interface SignatureFieldInput {
  page: 'last';
  xPercent: number;
  yPercent: number;
  widthPercent: number;
}

interface SealDocumentInput {
  fileDataUrl: string;
  fileName?: string;
  fileType?: string;
  title: string;
  documentHash: string;
  signers: SealSignerInput[];
  signatureField?: SignatureFieldInput;
  certificateAuthorityStatus?: string;
}

export async function sealPdfWithSignature(input: {
  fileDataUrl: string;
  signatureDataUrl: string;
  title: string;
  signerName: string;
  signerEmail: string;
  documentHash: string;
  signedAt: string;
}) {
  return sealPdfWithSignatures({
    fileDataUrl: input.fileDataUrl,
    title: input.title,
    documentHash: input.documentHash,
    signers: [
      {
        signerName: input.signerName,
        signerEmail: input.signerEmail,
        signatureDataUrl: input.signatureDataUrl,
        signedAt: input.signedAt
      }
    ]
  });
}

export async function sealDocumentWithSignatures(input: SealDocumentInput) {
  if (isPdfDocument(input.fileDataUrl, input.fileType, input.fileName)) {
    return sealPdfWithSignatures(input);
  }

  return sealExternalFileWithSignatures(input);
}

export async function sealPdfWithSignatures(input: SealDocumentInput) {
  if (!input.signers.length) {
    throw new Error('At least one signer is required.');
  }

  const pdfBytes = dataUrlToBytes(input.fileDataUrl, 'data:application/pdf;base64,');
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];
  const { width, height } = page.getSize();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const field = input.signatureField || { page: 'last' as const, xPercent: 4, yPercent: 4, widthPercent: 88 };
  const panelWidth = clamp((width * field.widthPercent) / 100, 280, width - 48);
  const panelHeight = clamp(56 + input.signers.length * 66, 122, Math.max(122, height - 48));
  const panelX = clamp(((width - panelWidth) * field.xPercent) / 100, 24, Math.max(24, width - panelWidth - 24));
  const panelY = clamp(((height - panelHeight) * field.yPercent) / 100, 24, Math.max(24, height - panelHeight - 24));

  page.drawRectangle({
    x: panelX,
    y: panelY,
    width: panelWidth,
    height: panelHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.09, 0.42, 0.53),
    borderWidth: 1.2,
    opacity: 0.96
  });
  page.drawText('Electronic signature', {
    x: panelX + 18,
    y: panelY + panelHeight - 24,
    size: 11,
    font: boldFont,
    color: rgb(0.05, 0.07, 0.09)
  });

  let rowY = panelY + panelHeight - 82;
  for (const signer of input.signers) {
    const signatureImage = await pdfDoc.embedPng(dataUrlToBytes(signer.signatureDataUrl, 'data:image/png;base64,'));

    page.drawImage(signatureImage, {
      x: panelX + 18,
      y: rowY - 8,
      width: 142,
      height: 38
    });
    page.drawText(`${signer.signerName} <${signer.signerEmail}>`, {
      x: panelX + 180,
      y: rowY + 18,
      size: 8.5,
      font: regularFont,
      color: rgb(0.16, 0.18, 0.22)
    });
    page.drawText(`Signed: ${signer.signedAt}`, {
      x: panelX + 180,
      y: rowY + 2,
      size: 8.5,
      font: regularFont,
      color: rgb(0.16, 0.18, 0.22)
    });
    page.drawText(`Role: ${signer.role || 'Signer'}`, {
      x: panelX + 180,
      y: rowY - 14,
      size: 8.5,
      font: regularFont,
      color: rgb(0.16, 0.18, 0.22)
    });
    rowY -= 66;
  }

  page.drawText(`Original SHA-256: ${input.documentHash.slice(0, 32)}...`, {
    x: panelX + 18,
    y: panelY + 25,
    size: 8.5,
    font: regularFont,
    color: rgb(0.16, 0.18, 0.22)
  });
  page.drawText(`Document: ${truncate(input.title, 55)}`, {
    x: panelX + 18,
    y: panelY + 10,
    size: 8.5,
    font: regularFont,
    color: rgb(0.16, 0.18, 0.22)
  });
  drawAuditCertificate(pdfDoc, {
    ...input,
    eventHash: createAuditEventHash(input)
  }, regularFont, boldFont);

  pdfDoc.setTitle(`${input.title} - signed`);
  pdfDoc.setSubject(`Signed electronically by ${input.signers.map((signer) => signer.signerName).join(', ')}`);
  pdfDoc.setProducer('Forg3');
  pdfDoc.setModificationDate(new Date(input.signers[input.signers.length - 1].signedAt));

  const signedBytes = await pdfDoc.save();
  return `data:application/pdf;base64,${Buffer.from(signedBytes).toString('base64')}`;
}

async function sealExternalFileWithSignatures(input: SealDocumentInput) {
  if (!input.signers.length) {
    throw new Error('At least one signer is required.');
  }

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([612, 792]);
  const left = 54;
  let y = 724;

  page.drawText('Forg3 Signed File Certificate', {
    x: left,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0.05, 0.07, 0.09)
  });
  y -= 30;
  page.drawText('This PDF records electronic signatures collected for the attached file hash below.', {
    x: left,
    y,
    size: 10,
    font: regularFont,
    color: rgb(0.2, 0.24, 0.27)
  });
  y -= 34;

  const rows = [
    ['Document', input.title],
    ['Original file', input.fileName || 'Uploaded file'],
    ['File type', input.fileType || mimeTypeFromDataUrl(input.fileDataUrl) || 'application/octet-stream'],
    ['Original SHA-256', input.documentHash],
    [
      'Proof package',
      'The original file is preserved separately. This certificate records approval of that exact file by SHA-256 hash.'
    ]
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

    for (const line of wrapText(value, 84)) {
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

  page.drawText('Electronic signatures', {
    x: left,
    y,
    size: 12,
    font: boldFont,
    color: rgb(0.05, 0.07, 0.09)
  });
  y -= 30;

  for (const signer of input.signers) {
    if (y < 120) {
      page = pdfDoc.addPage([612, 792]);
      y = 724;
    }

    page.drawRectangle({
      x: left,
      y: y - 54,
      width: 504,
      height: 70,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.84, 0.9, 0.92),
      borderWidth: 1
    });

    const signatureImage = await pdfDoc.embedPng(dataUrlToBytes(signer.signatureDataUrl, 'data:image/png;base64,'));
    page.drawImage(signatureImage, {
      x: left + 12,
      y: y - 40,
      width: 128,
      height: 34
    });
    page.drawText(`${signer.signerName} <${signer.signerEmail}>`, {
      x: left + 158,
      y: y - 8,
      size: 9,
      font: regularFont,
      color: rgb(0.16, 0.18, 0.22)
    });
    page.drawText(`Signed: ${signer.signedAt}`, {
      x: left + 158,
      y: y - 24,
      size: 9,
      font: regularFont,
      color: rgb(0.16, 0.18, 0.22)
    });
    page.drawText(`Role: ${signer.role || 'Signer'}`, {
      x: left + 158,
      y: y - 40,
      size: 9,
      font: regularFont,
      color: rgb(0.16, 0.18, 0.22)
    });
    y -= 86;
  }

  drawAuditCertificate(pdfDoc, {
    ...input,
    eventHash: createAuditEventHash(input),
    externalFileNotice: 'Original file was not modified; this PDF is the signed certificate for the stored original file.'
  }, regularFont, boldFont);

  pdfDoc.setTitle(`${input.title} - signed certificate`);
  pdfDoc.setSubject(`Signed electronically by ${input.signers.map((signer) => signer.signerName).join(', ')}`);
  pdfDoc.setProducer('Forg3');
  pdfDoc.setModificationDate(new Date(input.signers[input.signers.length - 1].signedAt));

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
    fileName?: string;
    fileType?: string;
    documentHash: string;
    signers: SealSignerInput[];
    eventHash: string;
    certificateAuthorityStatus?: string;
    externalFileNotice?: string;
  },
  regularFont: PDFFont,
  boldFont: PDFFont
) {
  const page = pdfDoc.addPage([612, 792]);
  const left = 54;
  let y = 724;

  page.drawText('Forg3 Audit Certificate', {
    x: left,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0.05, 0.07, 0.09)
  });
  y -= 34;
  page.drawText('This certificate summarizes the electronic signature event recorded by Forg3.', {
    x: left,
    y,
    size: 10,
    font: regularFont,
    color: rgb(0.2, 0.24, 0.27)
  });
  y -= 34;

  const rows = [
    ['Document', input.title],
    ...(input.fileName ? [['Original file', input.fileName]] : []),
    ...(input.fileType ? [['File type', input.fileType]] : []),
    ['Signers', input.signers.map((signer) => `${signer.signerName} <${signer.signerEmail}> at ${signer.signedAt}`).join('; ')],
    ['Original SHA-256', input.documentHash],
    ['Audit event hash', input.eventHash],
    ['Signature method', 'Drawn or typed electronic signature image sealed server-side'],
    ['Identity verification', input.signers.map((signer) => `${signer.signerEmail}: ${signer.identityVerificationStatus || 'not_required'}`).join('; ')],
    ['Certificate authority status', input.certificateAuthorityStatus || 'Not configured for this packet'],
    ['Token status', 'Single-use signing token consumed after completion'],
    ...(input.externalFileNotice ? [['External file handling', input.externalFileNotice]] : [])
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

function isPdfDocument(fileDataUrl: string, fileType?: string, fileName?: string) {
  return (
    fileDataUrl.toLowerCase().startsWith('data:application/pdf;base64,') ||
    String(fileType || '').toLowerCase().includes('pdf') ||
    String(fileName || '').toLowerCase().endsWith('.pdf')
  );
}

function mimeTypeFromDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,/i.exec(dataUrl.trim());
  return match?.[1]?.toLowerCase();
}

function createAuditEventHash(input: {
  title: string;
  documentHash: string;
  signers: SealSignerInput[];
}) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        title: input.title,
        documentHash: input.documentHash,
        signers: input.signers.map((signer) => ({
          signerName: signer.signerName,
          signerEmail: signer.signerEmail,
          signedAt: signer.signedAt,
          role: signer.role,
          identityVerificationStatus: signer.identityVerificationStatus
        }))
      })
    )
    .digest('hex');
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
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
