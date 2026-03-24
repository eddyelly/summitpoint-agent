import type { PrintTemplate } from '../types/index';

interface ZplBadgeData {
  attendeeName: string;
  qrCodeValue: string;
  serialNumber?: string;
  organization?: string;
  template: PrintTemplate;
}

export function generateZplLabel(data: ZplBadgeData): string {
  const { template } = data;
  const nameText = applyNameCase(data.attendeeName, template.nameCase);
  const orgText = data.organization || '';

  // Honeywell PC310T is 300 DPI: 1mm ≈ 11.81 dots
  const DPI = 300;
  const mmToDots = (mm: number) => Math.round(mm * (DPI / 25.4));

  const labelWidthDots = mmToDots(template.badgeWidthMm);
  const labelHeightDots = mmToDots(template.badgeHeightMm);

  // Font sizes
  const nameFontH = 60;
  const nameFontW = 54;
  const orgFontH = 36;
  const orgFontW = 32;

  // QR magnification (bigger = more visible)
  const qrMag = Math.max(5, Math.min(10, Math.round(template.qrCodeWidth / 4)));

  // Approximate text widths for centering (ZPL default font ~60% of height per char)
  const nameWidthApprox = nameText.length * nameFontW;
  const orgWidthApprox = orgText.length * orgFontW;

  // QR code size in dots: each module ≈ qrMag*2 dots, typical QR is ~25 modules
  const qrSizeDots = qrMag * 25 * 2;

  // Calculate total content height: name + gap + org + gap + QR + gap + SN
  const gap = 20;
  const snFontH = 24;
  const hasSn = template.showSerialNumber && data.serialNumber && template.snTop != null;
  const totalContentHeight = nameFontH + gap + (orgText ? orgFontH + gap : 0) + qrSizeDots + (hasSn ? gap + snFontH : 0);

  // Vertical centering: start Y so content is centered on label
  let currentY = Math.round((labelHeightDots - totalContentHeight) / 2);
  if (currentY < 10) currentY = 10;

  let zpl = '';
  zpl += '^XA\n';
  zpl += `^LL${labelHeightDots}\n`;
  zpl += `^PW${labelWidthDots}\n`;

  // ─── Name (centered horizontally) ───
  const nameX = Math.max(0, Math.round((labelWidthDots - nameWidthApprox) / 2));
  zpl += `^FO${nameX},${currentY}\n`;
  zpl += `^A0N,${nameFontH},${nameFontW}\n`;
  zpl += `^FD${nameText}^FS\n`;
  currentY += nameFontH + gap;

  // ─── Organization (centered horizontally) ───
  if (orgText) {
    const orgX = Math.max(0, Math.round((labelWidthDots - orgWidthApprox) / 2));
    zpl += `^FO${orgX},${currentY}\n`;
    zpl += `^A0N,${orgFontH},${orgFontW}\n`;
    zpl += `^FD${orgText}^FS\n`;
    currentY += orgFontH + gap;
  }

  // ─── QR code (centered horizontally) ───
  const qrX = Math.max(0, Math.round((labelWidthDots - qrSizeDots) / 2));
  zpl += `^FO${qrX},${currentY}\n`;
  zpl += `^BQN,2,${qrMag}\n`;
  zpl += `^FDMM,A${data.qrCodeValue}^FS\n`;
  currentY += qrSizeDots + gap;

  // ─── Serial number (centered horizontally) ───
  if (hasSn) {
    const snText = data.serialNumber!;
    const snWidthApprox = snText.length * 14;
    const snX = Math.max(0, Math.round((labelWidthDots - snWidthApprox) / 2));
    zpl += `^FO${snX},${currentY}\n`;
    zpl += `^A0N,${snFontH},${snFontH}\n`;
    zpl += `^FD${snText}^FS\n`;
  }

  zpl += '^XZ\n';
  return zpl;
}

function applyNameCase(name: string, nameCase: string): string {
  switch (nameCase) {
    case 'UPPERCASE':
      return name.toUpperCase();
    case 'LOWERCASE':
      return name.toLowerCase();
    case 'TITLE':
    default:
      return name
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
  }
}
