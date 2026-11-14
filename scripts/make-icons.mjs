// 生成品牌图标：一个 SVG 源 → 各种尺寸 PNG → favicon.ico
//
//   node scripts/make-icons.mjs
//
// 设计：近黑圆角底 + 一根斜向的「/」渐变条（顶部青、底部靛蓝），带一层柔光。
// ≤32px 用简化版（加粗斜杠、去掉光晕），保证小尺寸仍可辨认。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = {
  webIcons: path.join(root, "apps", "web", "public", "icons"),
  webPublic: path.join(root, "apps", "web", "public"),
  desktop: path.join(root, "apps", "desktop", "build"),
  extPublic: path.join(root, "apps", "browser-extension", "public"),
};

const BG_TOP = "#26292E";
const BG_BOTTOM = "#0F1114";
const BAR_TOP = "#7BEBF5";
const BAR_BOTTOM = "#4A57EE";

const RADIUS = 116;
const TILT = 18;

function svg({ rounded = true, glow = true } = {}) {
  const r = rounded ? RADIUS : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="0.55" stop-color="#191B1F"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
    <linearGradient id="bar" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="${BAR_TOP}"/>
      <stop offset="0.45" stop-color="#4FC9E8"/>
      <stop offset="1" stop-color="${BAR_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.32" r="0.62">
      <stop offset="0" stop-color="#5FD8F0" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#5FD8F0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="blur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="512" height="512" rx="${r}" fill="url(#bg)"/>
  <rect x="0" y="0" width="512" height="512" rx="${r}" fill="url(#halo)"/>
  ${rounded ? `<rect x="6" y="6" width="500" height="500" rx="${RADIUS - 5}" fill="none" stroke="url(#edge)" stroke-width="3"/>` : ""}

  <g transform="rotate(${TILT} 256 256)">
    ${glow ? `<rect x="224" y="118" width="66" height="276" rx="16" fill="${BAR_BOTTOM}" opacity="0.35" filter="url(#blur)"/>` : ""}
    <rect x="224" y="118" width="66" height="276" rx="16" fill="url(#bar)"/>
  </g>
</svg>`;
}

/** 小尺寸：斜杠更粗、无光晕、无边描 */
function svgSimple() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg2" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
    <linearGradient id="bar2" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="${BAR_TOP}"/>
      <stop offset="1" stop-color="${BAR_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="${RADIUS}" fill="url(#bg2)"/>
  <g transform="rotate(${TILT} 256 256)">
    <rect x="204" y="100" width="104" height="312" rx="24" fill="url(#bar2)"/>
  </g>
</svg>`;
}

const fullSvg = svg();

async function png(size, rounded = true) {
  const src = size <= 32 ? svgSimple() : svg({ rounded, glow: size >= 128 });
  return sharp(Buffer.from(src)).resize(size, size, { fit: "contain" }).png().toBuffer();
}

/** 手搓 ICO 容器（内含多张 PNG，Windows Vista+ 支持） */
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  entries.forEach(({ size, data }, i) => {
    const b = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, b + 0);
    dir.writeUInt8(size >= 256 ? 0 : size, b + 1);
    dir.writeUInt8(0, b + 2);
    dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(data.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += data.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

function write(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  console.log("wrote", path.relative(root, file), buf.length, "bytes");
}

async function main() {
  const sizes = [16, 32, 48, 64, 128, 192, 256, 512];
  const buffers = {};
  for (const s of sizes) buffers[s] = await png(s);

  for (const s of [16, 48, 128, 192, 512]) {
    write(path.join(out.webIcons, `logo-${s}.png`), buffers[s]);
  }
  write(path.join(out.webPublic, "icon-512.png"), buffers[512]);
  write(path.join(out.webPublic, "apple-icon.png"), await png(180));
  write(path.join(out.webIcons, "logo-icon.svg"), Buffer.from(fullSvg));
  write(path.join(out.webIcons, "logo-icon-dark.svg"), Buffer.from(fullSvg));

  write(
    path.join(out.webPublic, "favicon.ico"),
    buildIco([
      { size: 16, data: buffers[16] },
      { size: 32, data: buffers[32] },
      { size: 48, data: buffers[48] },
    ]),
  );

  write(path.join(out.desktop, "icon.png"), buffers[512]);

  for (const s of [16, 48, 128]) {
    write(path.join(out.extPublic, `logo-${s}.png`), buffers[s]);
  }
  write(path.join(out.extPublic, "logo.png"), buffers[128]);
  write(path.join(out.extPublic, "logo-full.png"), buffers[512]);

  write(path.join(root, "docs", "screenshots", "brand-icon.png"), buffers[512]);
  console.log("done");
}

await main();
