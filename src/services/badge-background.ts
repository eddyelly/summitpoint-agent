import {
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
} from 'pdf-lib';

/**
 * Cover-fit for the badge background.
 *
 * DUPLICATED, deliberately: this is a copy of
 * summitpoint-backend/src/badges/badge-background.util.ts. The two repos
 * deploy separately and share no package, and a badge that printed one way
 * from the desk agent and another way from the server would be worse than
 * the copy. If you change the fit here, change it there - the backend copy
 * has the unit tests.
 *
 * Why cover rather than the plain stretch this used to do: the artwork's
 * proportions and the badge's rarely match, and stretching distorts the
 * design - sponsor logos included. The web preview (object-cover) and the
 * phone (BoxFit.cover) have always cropped instead, so cropping is also what
 * the organiser approved on screen.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function coverRect(imgW: number, imgH: number, box: Box): Box {
  if (imgW <= 0 || imgH <= 0) return { ...box };

  const scale = Math.max(box.width / imgW, box.height / imgH);
  const width = imgW * scale;
  const height = imgH * scale;

  // Half the overflow hangs off each side, keeping the middle of the artwork
  // in the middle of the badge.
  return {
    x: box.x - (width - box.width) / 2,
    y: box.y - (height - box.height) / 2,
    width,
    height,
  };
}

export function drawBackgroundCover(
  page: {
    pushOperators: (...ops: any[]) => void;
    drawImage: (image: any, opts: Box) => void;
  },
  image: { width: number; height: number },
  box: Box,
): void {
  page.pushOperators(
    pushGraphicsState(),
    rectangle(box.x, box.y, box.width, box.height),
    clip(),
    // A clipping path, not something to paint - endPath consumes it.
    endPath(),
  );
  page.drawImage(image, coverRect(image.width, image.height, box));
  page.pushOperators(popGraphicsState());
}
