// 生成 PWA 图标的简单脚本
const fs = require('fs');
const path = require('path');

function svgIcon(size) {
  const s = size;
  const r = s * 0.18; // 圆角
  // 渐变背景：紫蓝渐变
  // 相机镜头图标（纯几何，无 emoji）
  const cx = s / 2, cy = s / 2;
  const outerR = s * 0.28; // 镜头外圆
  const innerR = s * 0.18; // 镜头内圆
  const bodyW = s * 0.72, bodyH = s * 0.56;
  const bodyX = (s - bodyW) / 2, bodyY = s * 0.28;
  const bodyR = s * 0.08;
  const humpW = s * 0.28, humpH = s * 0.1;
  const humpX = (s - humpW) / 2, humpY = bodyY - humpH * 0.6;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6c47ff"/>
      <stop offset="100%" stop-color="#ff6b9d"/>
    </linearGradient>
    <linearGradient id="lens" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#a0c4ff"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <!-- 背景 -->
  <rect width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
  <!-- 相机机身 -->
  <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="${bodyR}" fill="rgba(255,255,255,0.95)"/>
  <!-- 取景器小凸 -->
  <rect x="${humpX}" y="${humpY}" width="${humpW}" height="${humpH + s*0.04}" rx="${s*0.04}" fill="rgba(255,255,255,0.95)"/>
  <!-- 镜头外圆 -->
  <circle cx="${cx}" cy="${cy + s*0.04}" r="${outerR}" fill="#d0d8ff"/>
  <!-- 镜头中圆 -->
  <circle cx="${cx}" cy="${cy + s*0.04}" r="${s*0.22}" fill="#7b8fff"/>
  <!-- 镜头内圆（高光） -->
  <circle cx="${cx}" cy="${cy + s*0.04}" r="${innerR}" fill="url(#lens)"/>
  <!-- 镜头反光 -->
  <circle cx="${cx - outerR*0.3}" cy="${cy + s*0.04 - outerR*0.3}" r="${s*0.04}" fill="rgba(255,255,255,0.7)"/>
  <!-- 快门按钮 -->
  <circle cx="${s*0.76}" cy="${bodyY + s*0.08}" r="${s*0.05}" fill="#ff6b9d"/>
</svg>`;
}

const iconsDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

async function generate() {
  let sharp;
  try { sharp = require('sharp'); } catch (_) {}

  for (const size of [192, 512]) {
    const svgBuf = Buffer.from(svgIcon(size));
    const svgPath = path.join(iconsDir, `icon-${size}.svg`);
    const pngPath = path.join(iconsDir, `icon-${size}.png`);

    fs.writeFileSync(svgPath, svgBuf);

    if (sharp) {
      await sharp(svgBuf).png().toFile(pngPath);
      console.log(`生成 icon-${size}.png`);
    } else {
      fs.writeFileSync(pngPath, svgBuf);
      console.log(`icon-${size} 已创建（SVG格式，建议安装 sharp）`);
    }
  }
}

generate().then(() => console.log('图标生成完成')).catch(console.error);
