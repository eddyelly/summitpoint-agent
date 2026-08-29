import { rgb } from 'pdf-lib';

/**
 * Fit-inside for the badge background.
 *
 * DUPLICATED, deliberately: a copy of
 * summitpoint-backend/src/badges/badge-background.util.ts. The two repos
 * deploy separately and share no package, and a badge printed one way from
 * the desk agent and another way from the server would be worse than the
 * copy. Change one, change the other; the backend copy has the tests.
 *
 * Why fitted rather than drawn to the badge's exact size, which is what this
 * did before: the artwork's proportions and the badge's rarely match, and
 * stretching distorts the design - on this event's badges it made the round
 * logo an oval. Fitting loses nothing, at the cost of a band down two sides.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function containRect(imgW: number, imgH: number, box: Box): Box {
  if (imgW <= 0 || imgH <= 0) return { ...box };

  // min, not max: the image stops at whichever edge it meets first, so it
  // never leaves the badge.
  const scale = Math.min(box.width / imgW, box.height / imgH);
  const width = imgW * scale;
  const height = imgH * scale;

  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

export function drawBackgroundContain(
  page: {
    drawRectangle: (opts: any) => void;
    drawImage: (image: any, opts: Box) => void;
  },
  image: { width: number; height: number },
  box: Box,
): void {
  // White first: a fitted image does not cover the whole badge, and the band
  // should be white rather than whatever is underneath.
  page.drawRectangle({ ...box, color: rgb(1, 1, 1) });
  page.drawImage(image, containRect(image.width, image.height, box));
}
