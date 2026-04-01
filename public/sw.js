const CACHE_STATIC = 'family-album-static-v14';
const CACHE_THUMBS = 'family-album-thumbs-v2';
const STATIC_FILES = ['/', '/index.html', '/manifest.json'];

// ── 安装：预缓存静态文件 ──────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_STATIC).then(c => c.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

// ── 激活：清理旧版缓存 ──────────────────────
self.addEventListener('activate', e => {
  const keep = [CACHE_STATIC, CACHE_THUMBS];
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── 请求拦截 ────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. 原始媒体文件（非缩略图）不缓存，太大
  if (url.pathname.startsWith('/media/') && !url.pathname.startsWith('/media/thumbs/')) {
    return; // 直接走网络
  }

  // 2. API 请求不缓存（数据实时性）
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 3. 缩略图：Cache First，命中直接返回，否则网络请求后存入缓存
  if (url.pathname.startsWith('/media/thumbs/')) {
    e.respondWith(
      caches.open(CACHE_THUMBS).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const resp = await fetch(e.request);
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        } catch {
          return new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // 4. 静态资源（HTML/manifest/icons）：Cache First
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
