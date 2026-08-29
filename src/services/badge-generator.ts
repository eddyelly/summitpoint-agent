import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import type { PrintTemplate } from '../types/index';
import { getCachedTemplate } from './template-cache';
import { drawBackgroundCover } from './badge-background';

interface BadgeData {
  attendeeName: string;
  qrCodeValue: string;
  serialNumber?: string;
  template: PrintTemplate;
}

export async function generateBadgePdf(data: BadgeData): Promise<Buffer> {
  const { template } = data;
  const mmToPt = (mm: number) => mm * 2.835;

  const widthPt = mmToPt(template.badgeWidthMm);
  const heightPt = mmToPt(template.badgeHeightMm);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const page = pdfDoc.addPage([widthPt, heightPt]);

  // 1. Background image
  if (template.backgroundImageUrl) {
    try {
      const bgBytes = await getCachedTemplate(template.backgroundImageUrl);
      const isJpg =
        template.backgroundImageUrl.endsWith('.jpg') ||
        template.backgroundImageUrl.endsWith('.jpeg');
      const bgImage = isJpg
        ? await pdfDoc.embedJpg(bgBytes)
        : await pdfDoc.embedPng(bgBytes);
      // Cover-fit, not stretched: artwork whose proportions differ from the
      // badge would otherwise print distorted.
      drawBackgroundCover(page, bgImage, { x: 0, y: 0, width: widthPt, height: heightPt });
    } catch (err: any) {
      console.error('Failed to load badge background:', err.message);
    }
  }

  // 2. QR code
  const qrPngBuffer = await QRCode.toBuffer(data.qrCodeValue, {
    type: 'png',
    width: 300,
    margin: 0,
    errorCorrectionLevel: 'M',
  });
  const qrImage = await pdfDoc.embedPng(qrPngBuffer);
  const qrWidthPt = mmToPt(template.qrCodeWidth);
  const qrX = mmToPt(template.qrCodeLeft);
  // PDF origin is bottom-left; template coords are top-left
  const qrY = heightPt - mmToPt(template.qrCodeTop) - qrWidthPt;
  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrWidthPt, height: qrWidthPt });

  // 3. Attendee name
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const nameText = applyNameCase(data.attendeeName, template.nameCase);
  const nameColor = hexToRgb(template.textColor || '#000000');

  // Auto-scale font size to fit badge width
  let fontSize = 14;
  const maxNameWidth = widthPt - mmToPt(template.nameLeft) - 10;
  while (fontSize > 6 && font.widthOfTextAtSize(nameText, fontSize) > maxNameWidth) {
    fontSize -= 0.5;
  }

  const nameX = mmToPt(template.nameLeft);
  const nameY = heightPt - mmToPt(template.nameTop);
  page.drawText(nameText, { x: nameX, y: nameY, size: fontSize, font, color: nameColor });

  // 4. Serial number
  if (template.showSerialNumber && data.serialNumber && template.snTop != null) {
    const snFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const snX = mmToPt(template.snLeft || 0);
    const snY = heightPt - mmToPt(template.snTop);
    page.drawText(data.serialNumber, { x: snX, y: snY, size: 8, font: snFont, color: nameColor });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
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

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}
