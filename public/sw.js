/**
 * Caches map tiles across sessions.
 *
 * A daily player re-downloads the opening view every single day. Tiles are
 * immutable -- a 2018 aerial survey does not change -- so serving them from
 * cache is free correctness, and the standard framing is the same every round
 * of every game, which makes it the highest-value thing to keep.
 *
 * ONLY the city surveys are cached. Esri's World Imagery item states it "is not
 * intended to be used to export tiles for offline", and a service worker
 * retaining them across sessions is arguably the thing that forbids. See
 * PLAN.md section 15. Everything else falls through to the network untouched.
 */
const CACHE = 'nyc-tiles-v1'

/** Roughly a fortnight of daily play before the oldest entries are dropped. */
const MAX_ENTRIES = 900

const CACHEABLE = [
  /^https:\/\/maps\.nyc\.gov\/xyz\/.*\.png8$/,
  /^https:\/\/tiles\.arcgis\.com\/.*NYC_Orthos_.*\/tile\/.*$/,
]

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** Crude FIFO trim. The Cache API has no size limit of its own. */
async function trim(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_ENTRIES) return
  await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)))
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url
  if (event.request.method !== 'GET' || !CACHEABLE.some((r) => r.test(url))) return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request)
      if (hit) return hit

      const res = await fetch(event.request)
      // Only successful, non-opaque responses. An opaque response has an
      // unknown status, so caching one risks storing an error page forever.
      if (res.ok && res.type !== 'opaque') {
        cache.put(event.request, res.clone()).then(() => trim(cache))
      }
      return res
    }),
  )
})
