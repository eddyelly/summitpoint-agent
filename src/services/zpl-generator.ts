import type { PrintTemplate } from '../types/index';

interface ZplBadgeData {
  attendeeName: string;
  qrCodeValue: string;
  serialNumber?: string;
  template: PrintTemplate;
}

export function generateZplLabel(data: ZplBadgeData): string {
  const { template } = data;
  const nameText = applyNameCase(data.attendeeName, template.nameCase);

  // Honeywell PC310T is 300 DPI: 1mm ≈ 11.81 dots
  const DPI = 300;
  const mmToDots = (mm: number) => Math.round(mm * (DPI / 25.4));

  const labelWidthDots = mmToDots(template.badgeWidthMm);
  const labelHeightDots = mmToDots(template.badgeHeightMm);
  const qrTop = mmToDots(template.qrCodeTop);
  const qrLeft = mmToDots(template.qrCodeLeft);
  const qrSize = Math.max(3, Math.min(10, Math.round(template.qrCodeWidth / 5)));
  const nameTop = mmToDots(template.nameTop);
  const nameLeft = mmToDots(template.nameLeft);

  let zpl = '';
  zpl += '^XA\n';
  zpl += `^LL${labelHeightDots}\n`;
  zpl += `^PW${labelWidthDots}\n`;

  // QR code
  zpl += `^FO${qrLeft},${qrTop}\n`;
  zpl += `^BQN,2,${qrSize}\n`;
  zpl += `^FDMM,A${data.qrCodeValue}^FS\n`;

  // Attendee name
  zpl += `^FO${nameLeft},${nameTop}\n`;
  zpl += '^A0N,40,40\n';
  zpl += `^FD${nameText}^FS\n`;

  // Serial number
  if (template.showSerialNumber && data.serialNumber && template.snTop != null) {
    const snTop = mmToDots(template.snTop);
    const snLeft = mmToDots(template.snLeft || 0);
    zpl += `^FO${snLeft},${snTop}\n`;
    zpl += '^A0N,24,24\n';
    zpl += `^FD${data.serialNumber}^FS\n`;
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
