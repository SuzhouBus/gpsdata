const ROOT = location.href.substring(0, location.href.lastIndexOf('/'));

const CACHE_BLACKLIST = [
  ROOT + '/manifest.json',
];

const CACHE_NON_VOLATILE_LIST = [
  ROOT + '/archive/*',
  ROOT + '/images/szbus_*',
];

function urlMatch(url, list) {
  for (let pattern of list) {
    if (pattern.substr(-1) == '*') {
      let prefix = pattern.substr(0, pattern.length - 1);
      if (url.substr(0, prefix.length) == prefix)
        return true;
    } else {
      if (url == pattern)
        return true;
    }
  }
}

function fetchAndCache(e) {
  return fetch(e.request).then(r => {
    let clonedResponse = r.clone();
    if (!urlMatch(e.request.url, CACHE_BLACKLIST)) {
      e.waitUntil(caches.open('v1').then(cache => cache.put(e.request, clonedResponse)));
    }
    return r;
  });
}

self.addEventListener('fetch', function(e) {
  if (CACHE_BLACKLIST.includes(e.request.url)) {
    return;
  }

  if (urlMatch(e.request.url, CACHE_NON_VOLATILE_LIST)) {
    e.respondWith(caches.match(e.request).then(r => r || fetchAndCache(e)));
    return;
  }

  e.respondWith(fetchAndCache(e).catch(_ => caches.match(e.request)));
});
