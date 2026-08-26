import QRCode from 'qrcode';
import type { PrintTemplate } from '../types/index';

interface TsplBadgeData {
  attendeeName: string;
  qrCodeValue: string;
  serialNumber?: string;
  organization?: string;
  template: PrintTemplate;
  /**
   * The physical stock, when it differs from the badge template's design
   * size. TSPL's SIZE must describe the LABEL, not the artwork - get it wrong
   * and the printer feeds the wrong length and drifts a little further off
   * every label.
   */
  labelWidthMm?: number;
  labelHeightMm?: number;
  /** Gap between labels, in mm. 2mm is the usual die-cut gap. */
  gapMm?: number;
}

/**
 * Renders a badge as TSPL, for Xprinter-class label printers.
 *
 * TSPL is not a dialect of ZPL - it is a different language with a different
 * model. Where ZPL streams a field at a time inside ^XA/^XZ, TSPL declares
 * the label, clears the buffer, draws, then prints:
 *
 *   SIZE / GAP / DIRECTION / CLS / TEXT / QRCODE / PRINT
 *
 * Resolution differs too, and it is the mistake that would be hardest to
 * spot: the Honeywell PC310T is 300 dpi (11.81 dots/mm) while an XP-420B is
 * 203 dpi (8 dots/mm). Reusing the ZPL maths would place everything at
 * roughly 1.5x its intended position - plausible-looking output that is
 * quietly wrong.
 */
export function generateTsplLabel(data: TsplBadgeData): string {
  const { template } = data;
  const nameText = applyNameCase(data.attendeeName, template.nameCase);

  // XP-420B and most Xprinter label models are 203 dpi.
  const DOTS_PER_MM = 8;
  const mmToDots = (mm: number) => Math.round(mm * DOTS_PER_MM);

  const widthMm = data.labelWidthMm ?? template.badgeWidthMm;
  const heightMm = data.labelHeightMm ?? template.badgeHeightMm;
  const gapMm = data.gapMm ?? 2;

  const labelWidth = mmToDots(widthMm);
  const labelHeight = mmToDots(heightMm);

  // TSPL's built-in bitmap fonts, in dots at multiplier 1. Font "3" is the
  // one the printer's own test page uses and reads well at arm's length.
  const NAME_FONT = '3';
  const NAME_CHAR_W = 16;
  const NAME_CHAR_H = 24;
  const SMALL_FONT = '2';
  const SMALL_CHAR_W = 12;
  const SMALL_CHAR_H = 20;

  // QR cell size in dots. The code has to survive being scanned from a
  // lanyard at arm's length, so it is sized off the label rather than left
  // at a fixed guess - clamped because TSPL accepts 1..10.
  const targetQrDots = Math.round(labelWidth * 0.45);
  // The QR's REAL module count for this exact payload, not an estimate.
  //
  // The first version guessed 33 and the truth for a badge code is 21. It
  // therefore reserved 13mm of space the code never occupied, and - because
  // the block is centred on that height - printed everything too high with a
  // dead band underneath. Encoding the value costs nothing and the printer
  // and this code then agree on the size.
  const qrModules = qrModuleCount(data.qrCodeValue);
  let qrCell = clamp(Math.round(targetQrDots / qrModules), 1, 10);
  let qrSize = qrCell * qrModules;

  // Laid out top to bottom and centred, matching what the ZPL generator
  // produces - the two printers should turn out the same badge.
  const gap = mmToDots(3);
  const hasSn = Boolean(template.showSerialNumber && data.serialNumber);
  const orgText = (data.organization ?? '').trim();

  let nameScale = 1;
  // Shrink before wrapping: a name that overflows the label is worse than a
  // smaller one, and TSPL has no shrink-to-fit of its own.
  while (nameScale > 0 && nameText.length * NAME_CHAR_W * nameScale > labelWidth - mmToDots(4)) {
    nameScale -= 1;
    if (nameScale < 1) {
      nameScale = 1;
      break;
    }
  }

  const nameHeight = NAME_CHAR_H * nameScale;
  const orgHeight = orgText ? SMALL_CHAR_H : 0;
  const snHeight = hasSn ? SMALL_CHAR_H : 0;
  const contentHeight =
    nameHeight + (orgText ? gap / 2 + orgHeight : 0) + gap + qrSize + (hasSn ? gap / 2 + snHeight : 0);

  // Shrink the QR until the whole badge fits the label. Everything else is
  // text that has to stay legible; the code is the one element that can give
  // ground and still scan.
  const margin = mmToDots(2);
  let totalHeight = contentHeight;
  while (qrCell > 1 && totalHeight > labelHeight - margin * 2) {
    qrCell -= 1;
    const shrunk = qrCell * qrModules;
    totalHeight -= qrSize - shrunk;
    qrSize = shrunk;
  }

  let y = Math.max(margin, Math.round((labelHeight - totalHeight) / 2));

  const lines: string[] = [];
  lines.push(`SIZE ${widthMm} mm,${heightMm} mm`);
  lines.push(`GAP ${gapMm} mm,0`);
  // 1 = print with the label's top edge leading, so the badge reads the right
  // way up as it comes out.
  lines.push('DIRECTION 1');
  lines.push('REFERENCE 0,0');
  lines.push('CLS');

  const centred = (textLen: number, charW: number, scale: number) =>
    Math.max(0, Math.round((labelWidth - textLen * charW * scale) / 2));

  lines.push(
    `TEXT ${centred(nameText.length, NAME_CHAR_W, nameScale)},${y},"${NAME_FONT}",0,${nameScale},${nameScale},"${escapeTspl(nameText)}"`,
  );
  y += nameHeight;

  if (orgText) {
    y += Math.round(gap / 2);
    lines.push(
      `TEXT ${centred(orgText.length, SMALL_CHAR_W, 1)},${y},"${SMALL_FONT}",0,1,1,"${escapeTspl(orgText)}"`,
    );
    y += orgHeight;
  }

  y += gap;
  // ECC level M and automatic data mode - the same trade-off the ZPL path
  // makes, and enough redundancy for a badge that will get creased.
  lines.push(
    `QRCODE ${Math.round((labelWidth - qrSize) / 2)},${y},M,${qrCell},A,0,"${escapeTspl(data.qrCodeValue)}"`,
  );
  y += qrSize;

  if (hasSn) {
    const sn = data.serialNumber!;
    y += Math.round(gap / 2);
    lines.push(
      `TEXT ${centred(sn.length, SMALL_CHAR_W, 1)},${y},"${SMALL_FONT}",0,1,1,"${escapeTspl(sn)}"`,
    );
  }

  // `PRINT 1`, not `PRINT 1,1`.
  //
  // TSPL documents PRINT m,n as m sets of n copies, so 1,1 should be a single
  // label - but this firmware produced TWO for it, verified against the
  // agent's own job log showing exactly one payload sent. The single-argument
  // form is what the printer's own manual test uses, and it prints one.
  lines.push('PRINT 1');

  // CRLF, not LF. TSPL firmware expects it, and the working manual test used
  // it too - a payload separated by bare newlines can be swallowed silently.
  return lines.join('\r\n') + '\r\n';
}

/**
 * `"` and `\` end or escape a TSPL string argument, so an attendee whose name
 * contains one would otherwise truncate the command or corrupt the label.
 */
function escapeTspl(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * How many modules across this payload's QR really is.
 *
 * Falls back to a mid-range guess if encoding fails: a slightly mispositioned
 * code still scans, whereas refusing to build the label leaves someone at the
 * desk with no badge at all.
 */
function qrModuleCount(value: string): number {
  try {
    return QRCode.create(value, { errorCorrectionLevel: 'M' }).modules.size;
  } catch {
    return 25;
  }
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
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
        .join(' ');
  }
}
