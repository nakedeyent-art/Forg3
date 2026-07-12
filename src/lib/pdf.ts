export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

export async function sealPdfWithSignature(input: {
  fileDataUrl: string;
  signatureDataUrl: string;
  title: string;
  signerName: string;
  signerEmail: string;
  documentHash: string;
}) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdfBytes = dataUrlToBytes(input.fileDataUrl);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];
  const { width } = page.getSize();
  const signatureImage = await pdfDoc.embedPng(dataUrlToBytes(input.signatureDataUrl));
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const signedAt = new Date().toISOString();
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
  page.drawText(`Signed: ${signedAt}`, {
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

  pdfDoc.setTitle(`${input.title} - signed`);
  pdfDoc.setSubject(`Signed electronically by ${input.signerName}`);
  pdfDoc.setProducer('Forg3 Sign');
  pdfDoc.setModificationDate(new Date());

  const signedBytes = await pdfDoc.save();
  return `data:application/pdf;base64,${bytesToBase64(signedBytes)}`;
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
