const MANIFEST_PATH = '/manifest.json'
const CACHE_FETCH_LATEST_LIST = [
  location.origin + '/sz3.html',
  location.origin + '/sz3.legacy.html',
  location.origin + '/sz3.json',
  location.origin + '/sz4.json',
  location.origin + '/wj.json',
];
const CACHE_BLACKLIST = [
  location.origin + MANIFEST_PATH,
];

function fetchAndCache(request) {
  return fetch(request).then(r => {
    // Do not cache manifest.json.
    if (CACHE_BLACKLIST.includes(request.url))
      return r;
    else
      return caches.open('v1').then(cache => cache.put(request, r.clone())).then(x => r);
  });
}

self.addEventListener('fetch', function(e) {
  if (CACHE_BLACKLIST.includes(e.request.url)) {
    return;
  }

  if (CACHE_FETCH_LATEST_LIST.includes(e.request.url)) {
    e.respondWith(fetchAndCache(e.request).
        catch(r => caches.match(e.request)));
    return;
  }

  e.respondWith(caches.match(e.request).then(
      r => r || fetchAndCache(e.request))
  );
});
