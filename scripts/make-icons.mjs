// 生成品牌图标：一个 SVG 源 → 各种尺寸 PNG → favicon.ico
//
//   node scripts/make-icons.mjs
//
// 设计：深青渐变圆角底 + 白色「保险柜门」面 + 青色锁孔 + 右上薄荷色星芒（insight）。
// 纯几何、无中文字形，16px 下仍可辨认。

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

/** 圆形渐变的底：深青到近黑青 */
const BG_FROM = "#12706E";
const BG_TO = "#052F34";
const INK = "#0A3F44";
const MINT = "#8CF0D0";

function svg({ rounded = true } = {}) {
  const bg = `
    <defs>
      <linearGradient id="bg" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#1A8C86"/>
        <stop offset="0.45" stop-color="#0B5F60"/>
        <stop offset="1" stop-color="#03252B"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.22" cy="0.12" r="0.85">
        <stop offset="0" stop-color="#B8FFF0" stop-opacity="0.30"/>
        <stop offset="0.45" stop-color="#B8FFF0" stop-opacity="0.06"/>
        <stop offset="1" stop-color="#B8FFF0" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="plate" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#FFFFFF"/>
        <stop offset="0.6" stop-color="#F2FAF8"/>
        <stop offset="1" stop-color="#DCEFEC"/>
      </linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.85"/>
        <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.15"/>
      </linearGradient>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#02201F" flood-opacity="0.45"/>
      </filter>
    </defs>`;

  const bgRect = rounded
    ? `<rect x="0" y="0" width="512" height="512" rx="118" fill="url(#bg)"/>`
    : `<rect x="0" y="0" width="512" height="512" fill="url(#bg)"/>`;

  const r = rounded ? 118 : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${bg}
  ${bgRect}
  <rect x="0" y="0" width="512" height="512" rx="${r}" fill="url(#glow)"/>
  ${rounded ? `<rect x="8" y="8" width="496" height="496" rx="111" fill="none" stroke="url(#edge)" stroke-opacity="0.35" stroke-width="3"/>` : ""}

  <!-- 后层半透明面：制造纵深 -->
  <rect x="96" y="96" width="290" height="290" rx="82" fill="#FFFFFF" fill-opacity="0.13"/>
  <!-- 前面板 -->
  <rect x="111" y="111" width="290" height="290" rx="82" fill="url(#plate)" filter="url(#soft)"/>
  <rect x="111" y="111" width="290" height="290" rx="82" fill="none" stroke="#052F34" stroke-opacity="0.10" stroke-width="2"/>

  <!-- 锁盘环 -->
  <circle cx="256" cy="282" r="84" fill="none" stroke="#0A3F44" stroke-opacity="0.10" stroke-width="9"/>
  <!-- 薄荷弧：像仪表的进度刻度 -->
  <circle cx="256" cy="282" r="84" fill="none" stroke="#37D6BA" stroke-width="9" stroke-linecap="round" stroke-dasharray="148 380" transform="rotate(128 256 282)"/>
  <!-- 锁孔 -->
  <circle cx="256" cy="252" r="28" fill="#073C42"/>
  <path d="M246 272 h20 a7 7 0 0 1 7 7 l6 44 a10 10 0 0 1 -10 11 h-26 a10 10 0 0 1 -10 -11 l6 -44 a7 7 0 0 1 7 -7 z" fill="#073C42"/>

  <!-- 星芒（右上，压着面板边缘） -->
  <path d="M374 112 l12 32 32 12 -32 12 -12 32 -12 -32 -32 -12 32 -12 z" fill="${MINT}"/>
</svg>`;
}

/** 小尺寸（≤32px）用简化版：放大轮廓、去掉刻度与星芒，保证 16px 还能认出来 */
function svgSimple() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg2" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#1A8C86"/>
      <stop offset="0.5" stop-color="#0B5F60"/>
      <stop offset="1" stop-color="#03252B"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="118" fill="url(#bg2)"/>
  <rect x="88" y="88" width="336" height="336" rx="96" fill="#FFFFFF"/>
  <circle cx="256" cy="238" r="56" fill="#073C42"/>
  <path d="M232 272 h48 a12 12 0 0 1 12 12 l8 62 a16 16 0 0 1 -16 18 h-56 a16 16 0 0 1 -16 -18 l8 -62 a12 12 0 0 1 12 -12 z" fill="#073C42"/>
</svg>`;
}

const fullSvg = svg({ rounded: true });

async function png(size, rounded = true) {
  const src =
    size <= 32 ? svgSimple() : rounded ? fullSvg : svg({ rounded: false });
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

  // web：PNG 各尺寸 + 圆形/方形两张 SVG
  for (const s of [16, 48, 128, 192, 512]) {
    write(path.join(out.webIcons, `logo-${s}.png`), buffers[s]);
  }
  write(path.join(out.webPublic, "icon-512.png"), buffers[512]);
  write(path.join(out.webIcons, "logo-icon.svg"), Buffer.from(fullSvg));
  write(
    path.join(out.webIcons, "logo-icon-dark.svg"),
    Buffer.from(
      fullSvg.replace(/url\(#plate\)/g, "#F4FBFA").replaceAll(BG_FROM, "#0E5F5D"),
    ),
  );

  // favicon.ico
  write(
    path.join(out.webPublic, "favicon.ico"),
    buildIco([
      { size: 16, data: buffers[16] },
      { size: 32, data: buffers[32] },
      { size: 48, data: buffers[48] },
    ]),
  );

  // 桌面打包图标（electron-builder 会自己转 ico）
  write(path.join(out.desktop, "icon.png"), buffers[512]);

  // 浏览器扩展
  for (const s of [16, 48, 128]) {
    write(path.join(out.extPublic, `logo-${s}.png`), buffers[s]);
  }
  write(path.join(out.extPublic, "logo.png"), buffers[128]);
  write(path.join(out.extPublic, "logo-full.png"), buffers[512]);

  // iOS 主屏图标（layout.tsx 里 apple: "/apple-icon.png"）
  write(path.join(out.webPublic, "apple-icon.png"), await png(180));

  // 预览图（给人和文档看）
  write(path.join(root, "docs", "screenshots", "brand-icon.png"), buffers[512]);
  console.log("done");
}

await main();
