// 生成 PWA 图标的简单脚本
const fs = require('fs');
const path = require('path');

function svgIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size*0.18}" fill="#0a0a0f"/>
  <rect x="${size*0.12}" y="${size*0.12}" width="${size*0.76}" height="${size*0.76}" rx="${size*0.1}" fill="#13131a"/>
  <text x="50%" y="58%" font-size="${size*0.44}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">🎞</text>
</svg>`;
}

// 写 SVG（浏览器可直接使用 SVG 作为 icon）
const iconsDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// 尝试用 sharp 生成 PNG，否则用 SVG 替代
async function generate() {
  let sharp;
  try { sharp = require('sharp'); } catch (_) {}

  for (const size of [192, 512]) {
    const svgBuf = Buffer.from(svgIcon(size));
    const pngPath = path.join(iconsDir, `icon-${size}.png`);

    if (sharp) {
      await sharp(svgBuf).png().toFile(pngPath);
      console.log(`生成 icon-${size}.png`);
    } else {
      // 没有 sharp 时用 SVG 内容写入（浏览器会尝试加载但会失败，不影响功能）
      fs.writeFileSync(pngPath.replace('.png', '.svg'), svgBuf);
      // 复制一个空 PNG 占位
      fs.writeFileSync(pngPath, svgBuf); // 实际是 SVG 内容，部分设备能处理
      console.log(`icon-${size} 已创建（SVG格式）`);
    }
  }
}

generate().then(() => console.log('图标生成完成')).catch(console.error);
