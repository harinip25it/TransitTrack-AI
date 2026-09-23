import fs from "fs";
import path from "path";
import zlib from "zlib";

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  const crcTarget = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcVal = crc32(crcTarget);
  chunk.writeUInt32BE(crcVal, 8 + len);
  return chunk;
}

function createPng(width, height, pixelFn) {
  // Signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  
  // IHDR: width(4), height(4), bitDepth(1), colorType(6=RGBA), comp(0), filter(0), interlace(0)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8 bits per channel
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdr = makeChunk("IHDR", ihdrData);

  // Raw scanlines: each row starts with filter byte 0 (None)
  const rawBytes = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawBytes[offset++] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      rawBytes[offset++] = r;
      rawBytes[offset++] = g;
      rawBytes[offset++] = b;
      rawBytes[offset++] = a;
    }
  }

  const compressed = zlib.deflateSync(rawBytes, { level: 9 });
  const idat = makeChunk("IDAT", compressed);
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// Pixel rendering function for TransitTrack Icon
function transitPixel(x, y, w, h, isMaskable = false) {
  // Normalize coordinates to -1.0 .. +1.0
  const nx = (x / (w - 1)) * 2 - 1;
  const ny = (y / (h - 1)) * 2 - 1;
  const r = Math.sqrt(nx * nx + ny * ny);

  // Background: Deep sleek navy #0f172a (15, 23, 42) with subtle radial gradient toward brand #0369a1
  const bgGrad = Math.max(0, 1 - r * 0.7);
  let bgR = Math.round(15 + bgGrad * 12);
  let bgG = Math.round(23 + bgGrad * 32);
  let bgB = Math.round(42 + bgGrad * 65);

  // If not maskable, round outer corners
  if (!isMaskable) {
    // Squircle distance
    const sq = Math.pow(Math.abs(nx), 4) + Math.pow(Math.abs(ny), 4);
    if (sq > 0.85) {
      // outside squircle
      return [0, 0, 0, 0];
    }
    // border ring
    if (sq > 0.78) {
      return [2, 132, 199, 255]; // #0284c7 brand blue
    }
  }

  // Inner scale for maskable (pad by 0.78 scale)
  const scale = isMaskable ? 0.72 : 0.88;
  const sx = nx / scale;
  const sy = ny / scale;

  // Modern Transit Track symbol:
  // 1. Sleek arrow / transit rail lines converging or bullet train icon
  // Train body: from sy = -0.55 to sy = 0.45, sx from -0.38 to +0.38
  const inTrainBody = sy >= -0.52 && sy <= 0.45 && Math.abs(sx) <= (0.34 - Math.max(0, -sy - 0.2) * 0.15);
  
  // Front aerodynamic curve
  const trainFrontDist = Math.hypot(sx * 1.3, Math.max(0, -sy - 0.25));
  const isFrontCap = -sy >= 0.25 && trainFrontDist <= 0.42;

  if (isFrontCap || inTrainBody) {
    // Train windshield
    if (sy >= -0.36 && sy <= -0.16 && Math.abs(sx) <= 0.24) {
      return [186, 230, 253, 255]; // Sky 200 #bae6fd
    }
    // Headlights (two glowing circles near sy = 0.18, sx = -0.18 and +0.18)
    const hlLeft = Math.hypot(sx + 0.18, sy - 0.18);
    const hlRight = Math.hypot(sx - 0.18, sy - 0.18);
    if (hlLeft <= 0.055 || hlRight <= 0.055) {
      return [254, 240, 138, 255]; // warm gold/white light
    }
    // Speed/Accent stripe
    if (sy >= -0.05 && sy <= 0.04 && Math.abs(sx) <= 0.32) {
      return [2, 132, 199, 255]; // Brand blue stripe
    }
    // Train shell gradient
    return [248, 250, 252, 255]; // Crisp white/slate 50
  }

  // Two parallel transit rails at bottom (sy between 0.48 and 0.68)
  const railLeft = Math.abs(sx + 0.25) <= 0.04 && sy >= 0.35 && sy <= 0.75;
  const railRight = Math.abs(sx - 0.25) <= 0.04 && sy >= 0.35 && sy <= 0.75;
  if (railLeft || railRight) {
    return [2, 132, 199, 255]; // Brand blue rail
  }

  // Cross ties / sleeper tracks
  const isCrossTie1 = Math.abs(sy - 0.48) <= 0.025 && Math.abs(sx) <= 0.34;
  const isCrossTie2 = Math.abs(sy - 0.62) <= 0.025 && Math.abs(sx) <= 0.38;
  if (isCrossTie1 || isCrossTie2) {
    return [56, 189, 248, 220]; // Light cyan rail cross
  }

  // Radio signal / radar waves above train (AI telemetry arcs)
  const signalR1 = Math.hypot(sx, sy + 0.58);
  if (Math.abs(signalR1 - 0.24) <= 0.03 && sy <= -0.58 && Math.abs(sx) <= 0.22) {
    return [56, 189, 248, 255]; // #38bdf8
  }
  const signalR2 = Math.hypot(sx, sy + 0.58);
  if (Math.abs(signalR2 - 0.38) <= 0.03 && sy <= -0.62 && Math.abs(sx) <= 0.35) {
    return [2, 132, 199, 220]; // #0284c7
  }

  return [bgR, bgG, bgB, 255];
}

const iconsDir = path.join(process.cwd(), "frontend", "icons");
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log("Generating PWA PNG icons...");

const pwa192 = createPng(192, 192, (x, y, w, h) => transitPixel(x, y, w, h, false));
fs.writeFileSync(path.join(iconsDir, "icon-192.png"), pwa192);

const pwa512 = createPng(512, 512, (x, y, w, h) => transitPixel(x, y, w, h, false));
fs.writeFileSync(path.join(iconsDir, "icon-512.png"), pwa512);

const pwaMaskable = createPng(512, 512, (x, y, w, h) => transitPixel(x, y, w, h, true));
fs.writeFileSync(path.join(iconsDir, "icon-maskable-512.png"), pwaMaskable);

const appleTouch = createPng(180, 180, (x, y, w, h) => transitPixel(x, y, w, h, false));
fs.writeFileSync(path.join(iconsDir, "apple-touch-icon.png"), appleTouch);

const favicon32 = createPng(32, 32, (x, y, w, h) => transitPixel(x, y, w, h, false));
fs.writeFileSync(path.join(iconsDir, "favicon-32.png"), favicon32);

// Also generate a clean SVG icon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#0369a1"/>
    </linearGradient>
    <linearGradient id="railGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="512" height="512" rx="108" fill="url(#bg)"/>
  <rect width="504" height="504" x="4" y="4" rx="104" fill="none" stroke="#0284c7" stroke-width="6" opacity="0.6"/>
  
  <!-- Telemetry Signal Arcs -->
  <path d="M 180 85 A 90 90 0 0 1 332 85" fill="none" stroke="#38bdf8" stroke-width="12" stroke-linecap="round"/>
  <path d="M 130 65 A 140 140 0 0 1 382 65" fill="none" stroke="#0284c7" stroke-width="10" stroke-linecap="round" opacity="0.8"/>

  <!-- Train Body -->
  <path d="M 176 170 C 176 120 336 120 336 170 L 348 340 C 348 355 336 365 320 365 L 192 365 C 176 365 164 355 164 340 Z" fill="#ffffff"/>
  
  <!-- Windshield -->
  <path d="M 194 175 C 194 150 318 150 318 175 L 322 230 C 322 235 316 240 310 240 L 202 240 C 196 240 190 235 190 230 Z" fill="#bae6fd"/>
  
  <!-- Center Speed Stripe -->
  <rect x="168" y="270" width="176" height="20" rx="4" fill="#0284c7"/>
  
  <!-- Headlights -->
  <circle cx="205" cy="325" r="14" fill="#fef08a"/>
  <circle cx="205" cy="325" r="7" fill="#ffffff"/>
  <circle cx="307" cy="325" r="14" fill="#fef08a"/>
  <circle cx="307" cy="325" r="7" fill="#ffffff"/>

  <!-- Cowcatcher / Front Grill -->
  <rect x="220" y="348" width="72" height="6" rx="3" fill="#64748b"/>
  
  <!-- Transit Tracks / Rails -->
  <line x1="160" y1="380" x2="160" y2="455" stroke="url(#railGrad)" stroke-width="14" stroke-linecap="round"/>
  <line x1="352" y1="380" x2="352" y2="455" stroke="url(#railGrad)" stroke-width="14" stroke-linecap="round"/>
  
  <!-- Ties -->
  <line x1="135" y1="405" x2="377" y2="405" stroke="#38bdf8" stroke-width="10" stroke-linecap="round"/>
  <line x1="125" y1="438" x2="387" y2="438" stroke="#38bdf8" stroke-width="10" stroke-linecap="round"/>
</svg>`;

fs.writeFileSync(path.join(iconsDir, "icon.svg"), svgContent);
fs.writeFileSync(path.join(process.cwd(), "frontend", "icon.svg"), svgContent);

console.log("Successfully generated all PWA icons in /frontend/icons/");
