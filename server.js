const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

// ── ffmpeg（视频截帧）────────────────────────────────────────
// 按平台自动选择 bin/ 子目录中的静态二进制
// 目录结构：bin/windows/ffmpeg.exe  bin/liunx/ffmpeg  bin/mac/ffmpeg
const FFMPEG_BIN_MAP = {
  win32:  path.join('windows', 'ffmpeg.exe'),
  linux:  path.join('liunx',   'ffmpeg'),
  darwin: path.join('mac',     'ffmpeg'),
};
const LOCAL_FFMPEG = path.join(
  __dirname, 'bin',
  FFMPEG_BIN_MAP[process.platform] || path.join('liunx', 'ffmpeg')
);
const SYS_FFMPEG = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

let ffmpeg = null;
try {
  ffmpeg = require('fluent-ffmpeg');
  if (fs.existsSync(LOCAL_FFMPEG)) {
    ffmpeg.setFfmpegPath(LOCAL_FFMPEG);
    console.log('[ffmpeg] 平台:', process.platform, '→', LOCAL_FFMPEG);
  } else {
    // 回退：尝试系统 PATH 中的 ffmpeg
    ffmpeg.setFfmpegPath(SYS_FFMPEG);
    console.warn('[ffmpeg] 未找到本地二进制，使用系统 ffmpeg:', SYS_FFMPEG);
  }
} catch (_) {
  console.warn('[warn] fluent-ffmpeg 未安装，视频缩略图功能不可用');
}

// 从视频截取第 1 秒帧，生成 400x400 缩略图
function makeVideoThumb(videoPath, thumbPath) {
  return new Promise((resolve) => {
    if (!ffmpeg) return resolve(false);
    try {
      ffmpeg(videoPath)
        .on('end', () => resolve(true))
        .on('error', () => resolve(false))
        .screenshots({
          timestamps: ['00:00:01'],
          filename: path.basename(thumbPath),
          folder: path.dirname(thumbPath),
          size: '400x400'
        });
    } catch (_) {
      resolve(false);
    }
  });
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── 数据存储（内存缓存，避免每次请求都读磁盘） ──────────────
const DB_FILE = path.join(__dirname, 'db.json');
let _dbCache = null;
let _dbMtime = 0;

function readDB() {
  try {
    const stat = fs.statSync(DB_FILE);
    const mtime = stat.mtimeMs;
    if (_dbCache && mtime === _dbMtime) return _dbCache;
    _dbCache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    _dbMtime = mtime;
    return _dbCache;
  } catch (_) {
    return { media: [], albums: {} };
  }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  _dbCache = data;
  try { _dbMtime = fs.statSync(DB_FILE).mtimeMs; } catch (_) {}
}

// ── 目录 ──────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const THUMB_DIR  = path.join(__dirname, 'uploads', 'thumbs');
[UPLOAD_DIR, THUMB_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── EXIF 解析 ─────────────────────────────────────────────────
function readExif(filePath) {
  try {
    const exifReader = require('exif-reader');
    const buf = fs.readFileSync(filePath);
    // 在 JPEG 中搜索 APP1 / Exif 标记
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf[i] === 0xFF && buf[i+1] === 0xE1) {
        const segLen = buf.readUInt16BE(i + 2);
        const seg = buf.slice(i + 4, i + 2 + segLen);
        if (seg.slice(0, 4).toString() === 'Exif') {
          return exifReader(seg.slice(6));
        }
      }
    }
  } catch (_) {}
  return null;
}

// ── GPS → 粗略地名（离线，按经纬度范围判断省份）─────────────
function gpsToRegion(lat, lon) {
  if (!lat || !lon) return null;
  // 中国主要城市/省份经纬度范围（简化版，够家庭使用）
  const regions = [
    { name: '北京',    latR: [39.4, 41.1], lonR: [115.7, 117.4] },
    { name: '上海',    latR: [30.7, 31.9], lonR: [120.9, 122.2] },
    { name: '广州',    latR: [22.6, 23.9], lonR: [112.9, 114.1] },
    { name: '深圳',    latR: [22.4, 22.9], lonR: [113.8, 114.6] },
    { name: '杭州',    latR: [29.2, 30.6], lonR: [119.1, 120.7] },
    { name: '成都',    latR: [30.0, 31.4], lonR: [103.4, 104.9] },
    { name: '重庆',    latR: [28.1, 32.2], lonR: [105.2, 110.2] },
    { name: '武汉',    latR: [29.9, 31.4], lonR: [113.7, 115.1] },
    { name: '西安',    latR: [33.4, 34.8], lonR: [107.4, 109.3] },
    { name: '南京',    latR: [31.2, 32.6], lonR: [118.2, 119.3] },
    { name: '苏州',    latR: [30.8, 32.1], lonR: [119.7, 121.0] },
    { name: '厦门',    latR: [24.2, 24.9], lonR: [117.9, 118.4] },
    { name: '青岛',    latR: [35.5, 37.0], lonR: [119.3, 121.0] },
    { name: '天津',    latR: [38.5, 40.3], lonR: [116.7, 118.1] },
    { name: '沈阳',    latR: [41.1, 42.4], lonR: [122.7, 124.0] },
    { name: '哈尔滨',  latR: [44.9, 46.5], lonR: [125.8, 127.8] },
    { name: '长沙',    latR: [27.7, 28.7], lonR: [112.0, 113.6] },
    { name: '昆明',    latR: [24.5, 26.0], lonR: [102.1, 103.6] },
    { name: '三亚',    latR: [18.0, 18.6], lonR: [108.9, 109.9] },
    { name: '海南',    latR: [18.0, 20.2], lonR: [108.4, 111.2] },
    { name: '西藏',    latR: [26.8, 36.5], lonR: [78.3, 99.1]  },
    { name: '新疆',    latR: [35.4, 49.2], lonR: [73.5, 96.4]  },
    { name: '内蒙古',  latR: [37.4, 53.3], lonR: [97.2, 126.1] },
    { name: '日本',    latR: [24.0, 45.6], lonR: [122.9, 153.9] },
    { name: '泰国',    latR: [5.6,  20.5], lonR: [97.5, 105.7] },
    { name: '欧洲',    latR: [35.0, 71.0], lonR: [-25.0, 45.0] },
    { name: '美国',    latR: [24.0, 49.0], lonR: [-125.0, -67.0] },
  ];
  for (const r of regions) {
    if (lat >= r.latR[0] && lat <= r.latR[1] && lon >= r.lonR[0] && lon <= r.lonR[1]) {
      return r.name;
    }
  }
  // 粗略判断国内其他地区
  if (lat >= 18 && lat <= 53 && lon >= 73 && lon <= 135) return '中国其他';
  return '境外';
}

// ── 无AI规则分类 ──────────────────────────────────────────────
// 分类维度：季节、节假日、旅行、活动类型（从文件名关键词推断）
function classifyByRules(item) {
  const tags = [];
  const name = (item.original || '').toLowerCase();
  const { year, month, day, region } = item;

  // 1. 季节
  if ([3,4,5].includes(month))  tags.push('春季');
  if ([6,7,8].includes(month))  tags.push('夏季');
  if ([9,10,11].includes(month)) tags.push('秋季');
  if ([12,1,2].includes(month)) tags.push('冬季');

  // 2. 节假日（按月日推断）
  const md = `${String(month).padStart(2,'0')}-${String(day||1).padStart(2,'0')}`;
  if (md >= '01-01' && md <= '01-07') tags.push('元旦');
  if (md >= '01-20' && md <= '02-28') tags.push('春节');
  if (md >= '05-01' && md <= '05-07') tags.push('五一');
  if (md >= '10-01' && md <= '10-07') tags.push('国庆');
  if (month === 12 && parseInt(md.split('-')[1]) >= 20) tags.push('圣诞元旦');

  // 3. 地点标签
  if (region) tags.push(region);

  // 4. 文件名关键词推断活动
  const keywords = {
    '旅行': ['travel','trip','tour','旅','游','景','park'],
    '聚餐': ['food','eat','dinner','lunch','餐','饭','吃'],
    '生日': ['birthday','生日','birthday'],
    '婚礼': ['wedding','婚礼','婚'],
    '毕业': ['graduate','graduation','毕业'],
    '运动': ['sport','run','swim','gym','运动','跑','游泳'],
    '宠物': ['pet','cat','dog','猫','狗','宠物'],
    '孩子': ['baby','kid','child','孩子','宝宝','儿童'],
  };
  for (const [tag, kws] of Object.entries(keywords)) {
    if (kws.some(k => name.includes(k))) tags.push(tag);
  }

  // 5. 截图检测（文件名含 screenshot / 微信 等）
  if (/screenshot|screen_shot|截图|微信图片|wx_camera/i.test(name)) {
    tags.push('截图');
  }

  return [...new Set(tags)];
}

// ── Multer ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id  = crypto.randomBytes(12).toString('hex');
    cb(null, id + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2048 * 1024 * 1024 }, // 2GB
  fileFilter: (req, file, cb) => {
    // 支持所有常见图片和视频格式，含 iOS HEIC / WebP
    const ok = /\.(jpe?g|png|gif|webp|heic|heif|mp4|mov|avi|mkv|webm|3gp|m4v)$/i.test(
      path.extname(file.originalname)
    );
    cb(null, ok);
  }
});

// ── 工具 ──────────────────────────────────────────────────────
function parseDateFromFilename(name) {
  const m = name.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  if (m) {
    const [, y, mo, d] = m;
    if (!isNaN(new Date(`${y}-${mo}-${d}`))) return `${y}-${mo}-${d}`;
  }
  return new Date().toISOString().slice(0, 10);
}
function isVideo(filename) {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(path.extname(filename));
}
function gpsDecimal(val, ref) {
  if (!val) return null;
  const [d, m, s] = Array.isArray(val) ? val : [val, 0, 0];
  let dec = d + m / 60 + s / 3600;
  if (ref === 'S' || ref === 'W') dec = -dec;
  return Math.round(dec * 10000) / 10000;
}

// ── 静态资源 ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
// 缩略图：强缓存 7 天（内容基于 id，不会变化）
app.use('/media/thumbs', express.static(path.join(THUMB_DIR), {
  maxAge: '7d', immutable: true
}));
app.use('/media', express.static(UPLOAD_DIR));
app.use(express.json());

// ── 上传（含 EXIF 解析 + 自动分类）──────────────────────────
app.post('/api/upload', upload.array('files', 100), async (req, res) => {
  const db    = readDB();
  if (!db.media)  db.media  = [];
  if (!db.albums) db.albums = {};

  const sharp = (() => { try { return require('sharp'); } catch { return null; } })();
  const added = [];

  // 已有文件名集合，防止重复上传
  const existingNames = new Set(db.media.map(m => m.original + '_' + m.size));

  for (const file of req.files || []) {
    const dupKey = file.originalname + '_' + file.size;
    if (existingNames.has(dupKey)) {
      // 重复文件，删除刚上传的
      try { fs.unlinkSync(file.path); } catch (_) {}
      continue;
    }
    existingNames.add(dupKey);

    const id   = path.basename(file.filename, path.extname(file.filename));
    const type = isVideo(file.filename) ? 'video' : 'image';

    // EXIF 解析
    let takenAt = parseDateFromFilename(file.originalname);
    let lat = null, lon = null, region = null, cameraMake = null, cameraModel = null;
    let day = null;

    if (type === 'image') {
      const exif = readExif(file.path);
      if (exif) {
        // 拍摄时间
        const dt = exif.Photo?.DateTimeOriginal || exif.Image?.DateTime;
        if (dt) {
          // EXIF 日期格式: "2023:10:15 14:30:00"
          const cleaned = String(dt).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
          const d = new Date(cleaned);
          if (!isNaN(d)) takenAt = d.toISOString().slice(0, 10);
        }
        // GPS
        const gps = exif.GPSInfo;
        if (gps) {
          lat = gpsDecimal(gps.GPSLatitude,  gps.GPSLatitudeRef);
          lon = gpsDecimal(gps.GPSLongitude, gps.GPSLongitudeRef);
          region = gpsToRegion(lat, lon);
        }
        // 相机型号
        cameraMake  = exif.Image?.Make  || null;
        cameraModel = exif.Image?.Model || null;
      }
    }

    const [year, month] = takenAt.split('-').map(Number);
    day = parseInt(takenAt.split('-')[2]) || 1;

    // ── 缩略图生成 ──────────────────────────────────────────
    const thumbPath = path.join(THUMB_DIR, id + '.jpg');
    if (type === 'image' && sharp) {
      try {
        await sharp(file.path)
          .resize(400, 400, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toFile(thumbPath);
      } catch (_) {}
    } else if (type === 'video') {
      await makeVideoThumb(file.path, thumbPath);
    }

    const item = {
      id, filename: file.filename, original: file.originalname,
      type, size: file.size, takenAt, year, month, day,
      lat, lon, region,
      cameraMake, cameraModel,
      tags: [],
      createdAt: new Date().toISOString()
    };

    // 规则自动打标签
    item.tags = classifyByRules(item);

    db.media.push(item);
    added.push(item);
  }

  writeDB(db);
  res.json({ success: true, count: added.length, duplicates: (req.files?.length || 0) - added.length });
});

// ── 手机端：检查哪些文件已存在（去重用）────────────────────
app.post('/api/check-exists', express.json(), (req, res) => {
  const { files } = req.body; // [{ name, size }]
  if (!Array.isArray(files)) return res.json({ exists: [] });
  const { media } = readDB();
  const existingSet = new Set(media.map(m => m.original + '_' + m.size));
  const exists = files
    .filter(f => existingSet.has(f.name + '_' + f.size))
    .map(f => f.name);
  res.json({ exists });
});

// ── 时间线 ────────────────────────────────────────────────────
app.get('/api/timeline', (req, res) => {
  const { media } = readDB();
  const map = {};
  // 按月份分组收集所有媒体
  for (const m of media) {
    const key = `${m.year}-${String(m.month).padStart(2,'0')}`;
    if (!map[key]) {
      map[key] = {
        year: m.year, month: m.month,
        label: `${m.year}年${String(m.month).padStart(2,'0')}月`,
        items: []
      };
    }
    map[key].items.push(m);
  }
  // 对每个月份按 takenAt 降序排序，取第一个作为封面
  const result = Object.values(map).map(g => {
    g.items.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    const first = g.items[0];
    return {
      year: g.year, month: g.month, label: g.label,
      count: g.items.length,
      cover: first.id, coverType: first.type, coverFile: first.filename
    };
  });
  res.json(result.sort((a, b) =>
    b.year !== a.year ? b.year - a.year : b.month - a.month
  ));
});

// ── 媒体列表（支持按标签/地点/类型过滤）─────────────────────
app.get('/api/media', (req, res) => {
  const { year, month, tag, region, type: mediaType, page = 1, limit = 100 } = req.query;
  let { media } = readDB();

  if (year && month) media = media.filter(m => m.year === +year && m.month === +month);
  if (tag)       media = media.filter(m => m.tags?.includes(tag));
  if (region)    media = media.filter(m => m.region === region);
  if (mediaType) media = media.filter(m => m.type === mediaType);

  media.sort((a, b) => b.takenAt.localeCompare(a.takenAt) || b.createdAt?.localeCompare(a.createdAt||''));
  const total = media.length;
  const items = media.slice((+page - 1) * +limit, +page * +limit);

  // 允许客户端缓存 60 秒（手机弱网显著提速）
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    total,
    items: items.map(m => {
      const thumbFile = path.join(THUMB_DIR, m.id + '.jpg');
      const hasThumb  = fs.existsSync(thumbFile);
      return {
        id: m.id, type: m.type, filename: m.filename, original: m.original,
        takenAt: m.takenAt, region: m.region, tags: m.tags || [],
        url:   `/media/${m.filename}`,
        thumb: hasThumb ? `/media/thumbs/${m.id}.jpg`
             : (m.type === 'image' ? `/media/${m.filename}` : null)
      };
    })
  });
});

// ── 所有标签（用于分类页）─────────────────────────────────────
app.get('/api/tags', (req, res) => {
  const { media } = readDB();
  const tagMap = {};
  for (const m of media) {
    for (const t of (m.tags || [])) {
      if (!tagMap[t]) tagMap[t] = { tag: t, count: 0, cover: m.id, coverType: m.type, coverFile: m.filename };
      else if (tagMap[t].coverType !== 'image' && m.type === 'image') {
        // 优先用图片作封面
        tagMap[t].cover = m.id;
        tagMap[t].coverType = 'image';
        tagMap[t].coverFile = m.filename;
      }
      tagMap[t].count++;
    }
  }
  res.json(Object.values(tagMap).sort((a, b) => b.count - a.count));
});

// ── 所有地点 ──────────────────────────────────────────────────
app.get('/api/regions', (req, res) => {
  const { media } = readDB();
  const map = {};
  for (const m of media) {
    if (!m.region) continue;
    if (!map[m.region]) map[m.region] = { region: m.region, count: 0, cover: m.id, coverType: m.type, coverFile: m.filename };
    else if (map[m.region].coverType !== 'image' && m.type === 'image') {
      map[m.region].cover = m.id;
      map[m.region].coverType = 'image';
      map[m.region].coverFile = m.filename;
    }
    map[m.region].count++;
  }
  res.json(Object.values(map).sort((a, b) => b.count - a.count));
});

// ── 删除 ──────────────────────────────────────────────────────
app.delete('/api/media/:id', (req, res) => {
  const db  = readDB();
  const idx = db.media.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const item = db.media.splice(idx, 1)[0];
  writeDB(db);
  [path.join(UPLOAD_DIR, item.filename), path.join(THUMB_DIR, item.id + '.jpg')]
    .forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
  res.json({ success: true });
});

// ── 统计 ──────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const { media } = readDB();
  res.json({
    total:     media.length,
    images:    media.filter(m => m.type === 'image').length,
    videos:    media.filter(m => m.type === 'video').length,
    totalSize: media.reduce((s, m) => s + (m.size || 0), 0)
  });
});

// ── 启动 ──────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const ifaces = require('os').networkInterfaces();
  const ips = Object.values(ifaces).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => `http://${i.address}:${PORT}`);

  console.log('\n家庭相册已启动！');
  console.log('─'.repeat(40));
  console.log(`本机访问:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`局域网访问: ${ip}`));
  console.log('─'.repeat(40));
  console.log('在手机/电视浏览器打开上方局域网地址');
  console.log('安卓电视：菜单 → 添加到主屏幕\n');
});
