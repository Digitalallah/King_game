export const ORIGINAL_ARCHIVE_SHA256 = '64d0d5dae0a536626e944af58314b48a13682a49221d01a518fb01c86e53f153';
export const ORIGINAL_WIDTH = 640;
export const ORIGINAL_HEIGHT = 350;
export const ENTER_KEY = 257;

export const DOSBOX_CONF = `[sdl]
autolock=false

[dosbox]
machine=svga_s3
memsize=16

[render]
aspect=false
scaler=none

[cpu]
core=auto
cputype=auto
cycles=max

[mixer]
nosound=true

[midi]
mpu401=none

[autoexec]
mount c .
c:
cd kingrus
king.exe
`;

const BOOT_STEPS = [
  { keys: [53, 48, 48, 53, 55, ENTER_KEY], pauseAfter: 450 },
  { keys: [ENTER_KEY], pauseAfter: 450 },
  { keys: [49, 50, 51, 52, ENTER_KEY], pauseAfter: 900 },
];

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendKey(client, keyCode, holdMs = 34) {
  client.sendKeyEvent(keyCode, true);
  await delay(holdMs);
  client.sendKeyEvent(keyCode, false);
}

export async function passOriginalPrompts(client, keyDelay = 75) {
  for (const step of BOOT_STEPS) {
    for (const keyCode of step.keys) {
      await sendKey(client, keyCode);
      await delay(keyDelay);
    }
    await delay(step.pauseAfter);
  }
}

export async function synchronizeOriginalPointer(client, settleMs = 90) {
  // KING resets the DOS mouse to a symmetric range. js-dos then treats absolute
  // browser coordinates as deltas until its three-step mickey sync is consumed.
  client.sendMouseSync();
  for (let index = 0; index < 3; index += 1) {
    client.sendMouseMotion(0, 0);
    await delay(settleMs);
  }
}

export function mapBrowserKeyCode(keyCode) {
  switch (keyCode) {
    case 13: return ENTER_KEY;
    case 38: return 265;
    case 39: return 262;
    case 37: return 263;
    case 40: return 264;
    case 17: return 342;
    case 190: return 46;
    default: return keyCode;
  }
}

export function isPartnerSelectionFrame(pixels, width, height, channels = 3) {
  if (!pixels || width !== ORIGINAL_WIDTH || height !== ORIGINAL_HEIGHT) return false;
  const sampleHeight = Math.min(80, height);
  let green = 0;
  let total = 0;

  for (let y = 0; y < sampleHeight; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const offset = (y * width + x) * channels;
      const red = pixels[offset];
      const greenChannel = pixels[offset + 1];
      const blue = pixels[offset + 2];
      if (greenChannel > 70 && greenChannel > red * 1.35 && greenChannel > blue * 1.35) green += 1;
      total += 1;
    }
  }

  return total > 0 && green / total > 0.58;
}

export function isGameTableFrame(pixels, width, height, channels = 3) {
  if (!pixels || width !== ORIGINAL_WIDTH || height !== ORIGINAL_HEIGHT) return false;
  const colorAt = (x, y) => {
    const offset = (y * width + x) * channels;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  };
  const [grayRed, grayGreen, grayBlue] = colorAt(8, 8);
  const [tableRed, tableGreen, tableBlue] = colorAt(200, 130);
  const grayBackground = grayRed > 90
    && Math.abs(grayRed - grayGreen) < 12
    && Math.abs(grayRed - grayBlue) < 12;
  const greenTable = tableGreen > 70
    && tableGreen > tableRed * 1.35
    && tableGreen > tableBlue * 1.35;
  return grayBackground && greenTable;
}
