const MANIFEST_PATH = '/manifest.json'
const CACHE_FETCH_LATEST_LIST = [
  location.origin + '/sz3.json',
  location.origin + '/sz4.json',
  location.origin + '/wj.json',
];
const CACHE_BLACKLIST = [
  location.origin + MANIFEST_PATH,
];
self.addEventListener('fetch', function(e) {
  if (CACHE_FETCH_LATEST_LIST.includes(e.request.url)) {
    e.respondWith(fetch(e.request).catch(r => caches.match(e.request)));
    return;
  }

  e.respondWith(caches.match(e.request).then(
    r => r ||
      fetch(e.request).then(r =>  {
        // Do not cache manifest.json.
        if (CACHE_BLACKLIST.includes(e.request.url))
          return r;
        else
          return caches.open('v1').then(cache => cache.put(e.request, r.clone())).then(x => r);
      })
    )
  );
});
