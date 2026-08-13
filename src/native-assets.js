export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 350;

export const EGA_PALETTE = [
  [0x00, 0x00, 0x00],
  [0x00, 0x00, 0xaa],
  [0x00, 0xaa, 0x00],
  [0x00, 0xaa, 0xaa],
  [0xaa, 0x55, 0x00],
  [0xff, 0xaa, 0xaa],
  [0xff, 0xaa, 0x55],
  [0xaa, 0xaa, 0xaa],
  [0x55, 0x55, 0x55],
  [0x55, 0x55, 0xff],
  [0x55, 0xff, 0x55],
  [0x55, 0xff, 0xff],
  [0xff, 0x55, 0x55],
  [0xff, 0x55, 0xff],
  [0xff, 0xff, 0x55],
  [0xff, 0xff, 0xff],
];

export const KING_LIB_SHA256 = '627e4fe496a985d8c6cc43bba5a89e7b6947093cff9bf3f77effe89723054dbe';
export const KING_FNT_SHA256 = 'c97a2a69ebe88577d7453408bf92a1739ed6d7b5a8c010f1d3078b5b9c9dd364';

const FONT_6_SIZE = 0x600;
const FONT_8_SIZE = 0x800;
const FONT_14_SIZE = 0xe00;
const FONT_TOTAL_SIZE = FONT_6_SIZE + FONT_8_SIZE + FONT_14_SIZE;

function readU16(data, offset) {
  if (offset < 0 || offset + 1 >= data.length) throw new Error(`Чтение за границей ресурса: ${offset}`);
  return data[offset] | (data[offset + 1] << 8);
}

function decodeSpriteBlock(block, index, offset, sizeBlocks) {
  const width = readU16(block, 0);
  const height = readU16(block, 2);
  if (width <= 0 || height <= 0 || width > SCREEN_WIDTH || height > SCREEN_HEIGHT) {
    throw new Error(`Некорректный размер спрайта ${index}: ${width}×${height}`);
  }

  const pixels = new Uint8Array(width * height);
  let cursor = 6;

  for (let row = 0; row < height; row += 1) {
    const rowLength = readU16(block, cursor);
    const rowEnd = cursor + rowLength + 2;
    if (rowEnd > block.length) throw new Error(`Строка ${row} спрайта ${index} выходит за границы блока`);

    // Оригинальный декодер сдвигается на три байта: первый счётчик серии
    // находится по адресу cursor - 1.
    cursor += 3;
    let x = 0;

    while (cursor < rowEnd && x < width) {
      let count = block[cursor - 1];

      if (count > 127) {
        count -= 128;
        const color = block[cursor];
        cursor += 1;
        while (count > 0 && x < width) {
          pixels[row * width + x] = color;
          x += 1;
          count -= 1;
        }
      } else {
        while (count > 0 && x < width) {
          pixels[row * width + x] = block[cursor];
          cursor += 1;
          x += 1;
          count -= 1;
        }
      }

      cursor += 1;
    }

    if (cursor !== rowEnd || x !== width) {
      throw new Error(`Не удалось декодировать строку ${row} спрайта ${index}`);
    }
  }

  return { index, offset, sizeBlocks, width, height, pixels };
}

export function parseKingLib(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (data.length < 128) throw new Error('KING.LIB повреждён');

  // KING.LIB отличается от более позднего POLE2.LIB шестибайтным заголовком:
  // u16 количества, четыре нулевых байта, затем размеры блоков по 128 байт.
  const spriteCount = readU16(data, 0);
  const sizeTableOffset = 6;
  if (spriteCount !== 72 || sizeTableOffset + spriteCount > 128) {
    throw new Error(`Неожиданный заголовок KING.LIB: ${spriteCount} спрайтов`);
  }

  const sprites = [];
  let offset = 128;

  for (let index = 0; index < spriteCount; index += 1) {
    const sizeBlocks = data[sizeTableOffset + index];
    if (sizeBlocks === 0) {
      sprites.push(null);
      continue;
    }

    const sizeBytes = sizeBlocks << 7;
    if (offset + sizeBytes > data.length) throw new Error(`Спрайт ${index} выходит за границы KING.LIB`);
    sprites.push(decodeSpriteBlock(data.subarray(offset, offset + sizeBytes), index, offset, sizeBlocks));
    offset += sizeBytes;
  }

  if (offset !== data.length) throw new Error(`KING.LIB прочитан не полностью: ${offset} из ${data.length}`);
  return sprites;
}

export function parseKingFont(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (data.length !== FONT_TOTAL_SIZE) {
    throw new Error(`Неожиданный размер KING.FNT: ${data.length}`);
  }

  return {
    6: data.slice(0, FONT_6_SIZE),
    8: data.slice(FONT_6_SIZE, FONT_6_SIZE + FONT_8_SIZE),
    14: data.slice(FONT_6_SIZE + FONT_8_SIZE),
  };
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadKingAssets() {
  const [lib, font] = await Promise.all([
    fetchBytes(new URL('../assets/native/king.lib.bin', import.meta.url)),
    fetchBytes(new URL('../assets/native/king.fnt.bin', import.meta.url)),
  ]);

  return {
    sprites: parseKingLib(lib),
    fonts: parseKingFont(font),
  };
}

export function encodeCp866(text) {
  const bytes = [];
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code >= 0x0410 && code <= 0x042f) {
      bytes.push(0x80 + code - 0x0410);
    } else if (code >= 0x0430 && code <= 0x043f) {
      bytes.push(0xa0 + code - 0x0430);
    } else if (code >= 0x0440 && code <= 0x044f) {
      bytes.push(0xe0 + code - 0x0440);
    } else if (code === 0x0401) {
      bytes.push(0xf0);
    } else if (code === 0x0451) {
      bytes.push(0xf1);
    } else if (character === '№') {
      bytes.push(0xfc);
    } else {
      bytes.push(0x3f);
    }
  }
  return Uint8Array.from(bytes);
}

export class IndexedRenderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('Canvas 2D недоступен');
    this.context.imageSmoothingEnabled = false;
    this.sprites = assets.sprites;
    this.fonts = assets.fonts;
    this.buffer = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
    this.imageData = new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  clear(color = 0) {
    this.buffer.fill(color & 0x0f);
  }

  setPixel(x, y, color) {
    const targetX = Math.trunc(x);
    const targetY = Math.trunc(y);
    if (targetX < 0 || targetX >= SCREEN_WIDTH || targetY < 0 || targetY >= SCREEN_HEIGHT) return;
    this.buffer[targetY * SCREEN_WIDTH + targetX] = color & 0x0f;
  }

  fillRect(x, y, width, height, color) {
    const left = Math.max(0, Math.trunc(x));
    const top = Math.max(0, Math.trunc(y));
    const right = Math.min(SCREEN_WIDTH, Math.trunc(x + width));
    const bottom = Math.min(SCREEN_HEIGHT, Math.trunc(y + height));
    if (right <= left || bottom <= top) return;

    for (let row = top; row < bottom; row += 1) {
      this.buffer.fill(color & 0x0f, row * SCREEN_WIDTH + left, row * SCREEN_WIDTH + right);
    }
  }

  strokeRect(x, y, width, height, color, thickness = 1) {
    for (let inset = 0; inset < thickness; inset += 1) {
      this.fillRect(x + inset, y + inset, width - inset * 2, 1, color);
      this.fillRect(x + inset, y + height - inset - 1, width - inset * 2, 1, color);
      this.fillRect(x + inset, y + inset, 1, height - inset * 2, color);
      this.fillRect(x + width - inset - 1, y + inset, 1, height - inset * 2, color);
    }
  }

  drawSprite(spriteId, x, y, transparentColor = null) {
    const sprite = this.sprites[spriteId];
    if (!sprite) return;
    this.drawSpriteRegion(spriteId, 0, 0, sprite.width, sprite.height, x, y, transparentColor);
  }

  drawSpriteRegion(spriteId, sourceX, sourceY, width, height, x, y, transparentColor = null) {
    const sprite = this.sprites[spriteId];
    if (!sprite) return;

    for (let row = 0; row < height; row += 1) {
      const targetY = Math.trunc(y + row);
      const sourceRow = sourceY + row;
      if (targetY < 0 || targetY >= SCREEN_HEIGHT || sourceRow < 0 || sourceRow >= sprite.height) continue;

      for (let column = 0; column < width; column += 1) {
        const targetX = Math.trunc(x + column);
        const sourceColumn = sourceX + column;
        if (targetX < 0 || targetX >= SCREEN_WIDTH || sourceColumn < 0 || sourceColumn >= sprite.width) continue;
        const color = sprite.pixels[sourceRow * sprite.width + sourceColumn];
        if (transparentColor === null || color !== transparentColor) {
          this.buffer[targetY * SCREEN_WIDTH + targetX] = color;
        }
      }
    }
  }

  textWidth(text, spacing = 8) {
    const length = encodeCp866(text).length;
    return length === 0 ? 0 : (length - 1) * spacing + 8;
  }

  print(text, x, y, color = 15, glyphHeight = 8, spacing = 8) {
    const font = this.fonts[glyphHeight];
    if (!font) throw new Error(`Шрифт высотой ${glyphHeight} не найден`);
    const bytes = encodeCp866(text);

    for (let index = 0; index < bytes.length; index += 1) {
      const glyphOffset = bytes[index] * glyphHeight;
      for (let row = 0; row < glyphHeight; row += 1) {
        const bits = font[glyphOffset + row];
        for (let bit = 0; bit < 8; bit += 1) {
          if ((bits & (0x80 >> bit)) !== 0) this.setPixel(x + index * spacing + bit, y + row, color);
        }
      }
    }
  }

  printCentered(text, centerX, y, color = 15, glyphHeight = 8, spacing = 8) {
    const x = Math.round(centerX - this.textWidth(text, spacing) / 2);
    this.print(text, x, y, color, glyphHeight, spacing);
  }

  printShadowed(text, x, y, color = 15, glyphHeight = 8, spacing = 8) {
    this.print(text, x + 1, y + 1, 0, glyphHeight, spacing);
    this.print(text, x, y, color, glyphHeight, spacing);
  }

  present() {
    const rgba = this.imageData.data;
    for (let source = 0, target = 0; source < this.buffer.length; source += 1, target += 4) {
      const color = EGA_PALETTE[this.buffer[source] & 0x0f];
      rgba[target] = color[0];
      rgba[target + 1] = color[1];
      rgba[target + 2] = color[2];
      rgba[target + 3] = 255;
    }
    this.context.putImageData(this.imageData, 0, 0);
  }
}
