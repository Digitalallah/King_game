export const PARTNER_COLUMNS = [205, 295, 375, 460];
export const PARTNER_ROWS = [68, 180, 290];
export const PLAYER_CARD_TOP = 280;
export const PLAYER_CARD_HEIGHT = 60;
export const PLAYER_CARD_WIDTH = 52;

const BLACK_TOLERANCE = 18;
const WHITE_TOLERANCE = 18;
const GRAY_MIN = 135;
const GRAY_MAX = 205;

function colorAt(pixels, width, channels, x, y) {
  const offset = (y * width + x) * channels;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
}

function isBlack(color) {
  return color[0] < BLACK_TOLERANCE
    && color[1] < BLACK_TOLERANCE
    && color[2] < BLACK_TOLERANCE;
}

function isWhite(color) {
  return color[0] > 255 - WHITE_TOLERANCE
    && color[1] > 255 - WHITE_TOLERANCE
    && color[2] > 255 - WHITE_TOLERANCE;
}

function isTableGray(color) {
  return color[0] >= GRAY_MIN
    && color[0] <= GRAY_MAX
    && Math.abs(color[0] - color[1]) < 8
    && Math.abs(color[0] - color[2]) < 8;
}

export function partnerAtPoint(x, y) {
  let best = null;

  for (let row = 0; row < PARTNER_ROWS.length; row += 1) {
    for (let column = 0; column < PARTNER_COLUMNS.length; column += 1) {
      const centerX = PARTNER_COLUMNS[column];
      const centerY = PARTNER_ROWS[row];
      const dx = Math.abs(x - centerX);
      const dy = Math.abs(y - centerY);
      if (dx > 48 || dy > 52) continue;
      const distance = dx * dx + dy * dy;
      if (!best || distance < best.distance) {
        best = {
          index: row * PARTNER_COLUMNS.length + column,
          x: centerX,
          y: centerY,
          distance,
        };
      }
    }
  }

  if (!best) return null;
  const { distance: _distance, ...partner } = best;
  return partner;
}

export function detectPlayerCardSlots(pixels, width, height, channels = 3) {
  if (!pixels || width !== 640 || height !== 350 || channels < 3) return [];
  const top = PLAYER_CARD_TOP;
  const bottom = top + PLAYER_CARD_HEIGHT - 3;
  const leftEdges = [];

  for (let x = 120; x < 530; x += 1) {
    const atTop = colorAt(pixels, width, channels, x, top);
    const rightAtTop = colorAt(pixels, width, channels, x + 1, top);
    const cornerAtTop = colorAt(pixels, width, channels, x + 2, top);
    const belowTop = colorAt(pixels, width, channels, x, top + 1);
    const startsSuit = isTableGray(atTop)
      && isTableGray(rightAtTop)
      && isBlack(cornerAtTop);
    const overlapsPrevious = isBlack(atTop) && isWhite(belowTop);
    if (!startsSuit && !overlapsPrevious) continue;

    let verticalBorderPixels = 0;
    for (let y = top + 2; y <= bottom; y += 1) {
      if (isBlack(colorAt(pixels, width, channels, x, y))) verticalBorderPixels += 1;
    }

    if (verticalBorderPixels >= 54) leftEdges.push(x);
  }

  return leftEdges.slice(0, 8).map((left, index, all) => {
    const nextLeft = all[index + 1];
    const overlapped = Number.isFinite(nextLeft) && nextLeft - left < PLAYER_CARD_WIDTH;
    const visibleRight = overlapped ? nextLeft : left + PLAYER_CARD_WIDTH;
    return {
      index,
      left,
      right: visibleRight,
      top,
      bottom: top + PLAYER_CARD_HEIGHT,
      clickX: Math.floor((left + visibleRight - 1) / 2),
      clickY: top + Math.floor(PLAYER_CARD_HEIGHT / 2),
    };
  });
}

export function playerCardAtPoint(slots, x, y) {
  if (!Array.isArray(slots) || y < PLAYER_CARD_TOP - 14 || y > 349) return null;

  for (const slot of slots) {
    if (x >= slot.left - 3 && x < slot.right + 3) return slot;
  }

  let nearest = null;
  for (const slot of slots) {
    const center = (slot.left + slot.right) / 2;
    const distance = Math.abs(x - center);
    if (distance <= 9 && (!nearest || distance < nearest.distance)) {
      nearest = { slot, distance };
    }
  }
  return nearest?.slot || null;
}
