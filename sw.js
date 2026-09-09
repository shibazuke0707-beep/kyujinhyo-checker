/*
 * 求人票チェッカー Service Worker
 *
 * このツールは最低賃金テーブルと賃金統計を年2回程度更新する。
 * キャッシュを素朴に使うと「ホーム画面から開くと去年の基準で判定される」
 * という致命的な状態になるため、次の方針をとる。
 *
 *   HTML  : 通信優先。開くたびに新しい版を取りに行き、
 *           オフラインのときだけキャッシュを使う。
 *   その他 : キャッシュ優先。アイコンなど変わらないものに毎回通信しない。
 *
 * データを更新したときは CACHE_VERSION を必ず上げること。
 * 上げ忘れると古いキャッシュが残り続ける。
 */

const CACHE_VERSION = 'v6-2026-09';
const CACHE_NAME = `kyujinhyo-checker-${CACHE_VERSION}`;

// オフラインでも開けるように、最初に取り込んでおくもの
const PRECACHE = [
  './',
  './index.html',
  './privacy.html',
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/favicon-32.png',
  './assets/favicon-16.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 1つ失敗しても全体を巻き込まないよう個別に取り込む
      .then(cache => Promise.allSettled(
        PRECACHE.map(url => cache.add(new Request(url, { cache: 'reload' })))
      ))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 古い版のキャッシュを片付ける
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('kyujinhyo-checker-') && n !== CACHE_NAME)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // GET 以外と外部ドメインへの通信は素通し
  // (アクセス解析のビーコンをキャッシュしないため)
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const isDocument =
    req.mode === 'navigate' || req.destination === 'document';

  if (isDocument) {
    // HTML は通信優先。最新の判定基準を確実に届ける
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        // オフライン時はキャッシュへ。個別になければトップを返す
        const cached = await caches.match(req);
        return cached || await caches.match('./index.html');
      }
    })());
    return;
  }

  // それ以外はキャッシュ優先
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      return cached || Response.error();
    }
  })());
});

// ページ側から「すぐ新しい版に切り替えて」と指示されたとき
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
