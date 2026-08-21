import QRCode from 'qrcode';
import type { PrintTemplate } from '../types/index';

interface ZplBadgeData {
  attendeeName: string;
  qrCodeValue: string;
  serialNumber?: string;
  organization?: string;
  template: PrintTemplate;
}

/**
 * Renders a badge as ZPL, laid out the way the organiser designed it.
 *
 * The template's positions are CENTRE-anchored PERCENTAGES of the badge, not
 * millimetres and not top-left corners. That is what the badge designer
 * produces: sliders capped at 100, a preview positioned with `top: X%` and
 * `left: Y%` under `transform: -translate-x-1/2 -translate-y-1/2`, and a
 * caption reading "Top: X% - Left: Y% - Size: Z%".
 *
 * The previous version ignored those values entirely and stacked name above
 * QR on its own vertical centring, so nothing an organiser laid out had any
 * effect on what the label printer produced.
 */
export function generateZplLabel(data: ZplBadgeData): string {
  const { template } = data;
  const nameText = applyNameCase(data.attendeeName, template.nameCase);

  // Honeywell PC310T is 300 DPI: 1mm = 11.81 dots.
  const DPI = 300;
  const mmToDots = (mm: number) => Math.round(mm * (DPI / 25.4));

  const W = mmToDots(template.badgeWidthMm);
  const H = mmToDots(template.badgeHeightMm);

  // Percentage of the label to an absolute dot position.
  const pctX = (pct: number) => Math.round((pct / 100) * W);
  const pctY = (pct: number) => Math.round((pct / 100) * H);

  let zpl = '^XA\n';
  zpl += `^LL${H}\n`;
  zpl += `^PW${W}\n`;
  // Print every field in black on white regardless of what came before.
  zpl += '^LH0,0\n';

  // ─── QR code ───
  //
  // `^BQ` sizes a QR by MAGNIFICATION - whole dots per module - so the size
  // is quantised and capped: magnification cannot exceed 10, which puts a
  // hard ceiling on how large a QR this command can draw. Rather than guess
  // the module count, encode the real payload to find it, so the code is
  // centred on its true size rather than an estimate.
  const modules = qrModuleCount(data.qrCodeValue);
  const targetQrDots = pctX(template.qrCodeWidth);
  const magnification = clamp(Math.round(targetQrDots / modules), 1, 10);
  const qrDots = magnification * modules;

  // Centre-anchored, then clamped so a template that would hang off the edge
  // prints fully rather than being cut - a half-scanned QR is a useless badge.
  const qrLeft = clamp(pctX(template.qrCodeLeft) - Math.round(qrDots / 2), 0, Math.max(0, W - qrDots));
  const qrTop = clamp(pctY(template.qrCodeTop) - Math.round(qrDots / 2), 0, Math.max(0, H - qrDots));

  zpl += `^FO${qrLeft},${qrTop}\n`;
  zpl += `^BQN,2,${magnification}\n`;
  zpl += `^FDMM,A${escapeZpl(data.qrCodeValue)}^FS\n`;

  // ─── Name ───
  //
  // `^FB` with the `C` justification centres the text inside a block, which
  // is exact - the old code estimated glyph widths from the font's width
  // parameter and centred on that guess, which drifts with every name.
  const nameFontH = fontHeightFor(nameText, W);
  zpl += fieldCentredText({
    text: nameText,
    centreXDots: pctX(template.nameLeft),
    centreYDots: pctY(template.nameTop),
    fontHeight: nameFontH,
    labelWidth: W,
    labelHeight: H,
  });

  // No organisation line: the backend's PrintJobPayload.template carries no
  // org fields, so there is nothing to render here. Adding one would mean
  // extending that payload first.

  // ─── Serial number ───
  if (template.showSerialNumber && data.serialNumber && template.snTop != null && template.snLeft != null) {
    zpl += fieldCentredText({
      text: data.serialNumber,
      centreXDots: pctX(template.snLeft),
      centreYDots: pctY(template.snTop),
      fontHeight: Math.round(nameFontH * 0.4),
      labelWidth: W,
      labelHeight: H,
    });
  }

  zpl += '^XZ\n';
  return zpl;
}

/**
 * One line of text centred on a point.
 *
 * The block is made symmetrical about `centreXDots` and never wider than the
 * space available on the narrower side, so `^FB`'s centring lands exactly on
 * the requested point instead of on the middle of the label.
 *
 * `^FO` places the TOP of the text, so half the font height is subtracted to
 * make the given point the text's vertical centre - matching the designer's
 * preview, where the same coordinate is the middle of the element.
 */
function fieldCentredText(o: {
  text: string;
  centreXDots: number;
  centreYDots: number;
  fontHeight: number;
  labelWidth: number;
  labelHeight: number;
}): string {
  const half = Math.min(o.centreXDots, o.labelWidth - o.centreXDots);
  const blockWidth = Math.max(1, half * 2);
  const blockLeft = Math.max(0, o.centreXDots - Math.round(blockWidth / 2));

  const top = clamp(
    o.centreYDots - Math.round(o.fontHeight / 2),
    0,
    Math.max(0, o.labelHeight - o.fontHeight),
  );

  // Two lines allowed so a long name wraps instead of being truncated.
  const fontWidth = Math.round(o.fontHeight * 0.9);
  return (
    `^FO${blockLeft},${top}\n` +
    `^A0N,${o.fontHeight},${fontWidth}\n` +
    `^FB${blockWidth},2,0,C\n` +
    `^FD${escapeZpl(o.text)}^FS\n`
  );
}

/**
 * The QR's real module count for this payload.
 *
 * Encoding it is exact where a guess is not: a short code is 21 modules and a
 * longer one 33, and centring on the wrong figure offsets the code by
 * millimetres. Falls back to 25 - a mid-range version - if encoding fails,
 * because a slightly offset badge beats no badge at the desk.
 */
function qrModuleCount(value: string): number {
  try {
    return QRCode.create(value, { errorCorrectionLevel: 'M' }).modules.size;
  } catch {
    return 25;
  }
}

/**
 * Name font size, scaled to the label and shrunk for long names.
 *
 * Fixed at 60 dots before, which is 5mm - small on a 96mm badge and unable to
 * adapt to a different label size.
 */
function fontHeightFor(text: string, labelWidth: number): number {
  const base = Math.round(labelWidth * 0.09);
  if (text.length > 24) return Math.round(base * 0.62);
  if (text.length > 16) return Math.round(base * 0.78);
  return base;
}

/**
 * `^`, `~` and `\` are ZPL control characters. An unescaped one in an
 * attendee's name would be read as a command - at best mangling the label, at
 * worst producing a badge that is silently wrong.
 */
function escapeZpl(text: string): string {
  return text.replace(/([\^~\\])/g, '\\$1');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
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
