const ROOT = location.href.substring(0, location.href.lastIndexOf('/'));

const MANIFEST_URL = ROOT + '/manifest.json';

const CACHE_ALWAYS_CHECK_LIST = [
  MANIFEST_URL,
  ROOT + '/newbuses.csv',
];

const CACHE_NON_VOLATILE_LIST = [
  ROOT + '/archive/*',
  ROOT + '/images/szbus_*',
];

const CACHE_MANAGED_LIST = [
  ROOT + '/sz3.json',
  ROOT + '/sz4.json',
  ROOT + '/wj.json',
  ROOT + '/cs.json',
  ROOT + '/ks.json',
];

const HEADER_CACHE_ID = 'X-Service-Worker-Cache-Id';
const HEADER_FALLBACK = 'X-Service-Worker-Fallback';

let last_update_time = null;

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

// This is made async to workaround a bug in Edge, where the constructor of Response does not accept |response.body| or ReadableStream objects.
function renewResponseAsync(response, options) {
  return response.clone().blob().then(blob => {
    let newHeaders = options.headers || response.headers || {};
    if (!(newHeaders instanceof Headers)) {
      newHeaders = new Headers(response.headers);
      for (let [name, value] of Object.entries(options.headers)) {
        newHeaders.set(name, value);
      }
    }
    return new Response(blob, {
      status: options.status || response.status,
      statusText: options.statusText || response.statusText,
      headers: newHeaders,
    });
  });
}

function fetchAndCache(request, e) {
  let last_update_time_promise = CACHE_MANAGED_LIST.includes(request.url) ? getLastUpdateTime() : Promise.resolve();
  return Promise.all([fetch(request), last_update_time_promise]).then(([response, last_update_time]) => {
    let clonedResponsePromise;
    if (last_update_time) {
      clonedResponsePromise = renewResponseAsync(response, {headers: {[HEADER_CACHE_ID]: last_update_time}});
    } else {
      clonedResponsePromise = Promise.resolve(response.clone());
    }
    e.waitUntil(clonedResponsePromise.then(clonedResponse => caches.open('v1').then(cache => cache.put(request, clonedResponse))));
    if (request.url == MANIFEST_URL) {
      response.clone().json().then(manifest => last_update_time = manifest.last_update_time);
    }
    return response;
  });
}

function handleFetchDefault(request, e) {
  return fetchAndCache(request, e).catch(_ =>
      caches.match(new Request(request, {cache: 'default'})).then(response =>
      response && renewResponseAsync(response, {headers: {[HEADER_FALLBACK]: 1}})) );
}

function getLastUpdateTime() {
  if (last_update_time)
    return Promise.resolve(last_update_time);

  return caches.match(new Request(MANIFEST_URL)).then(response => response ? response.json() : {}).
      then(manifest => last_update_time = manifest.last_update_time);
}

self.addEventListener('fetch', function(e) {
  let request = e.request;
  if (CACHE_ALWAYS_CHECK_LIST.includes(request.url)) {
    request = new Request(request, {cache: 'no-cache'});
  }

  if (urlMatch(request.url, CACHE_NON_VOLATILE_LIST)) {
    e.respondWith(caches.match(request).then(r => r || fetchAndCache(e.request, e)));
  } else if (CACHE_MANAGED_LIST.includes(request.url)) {
    e.respondWith(Promise.all([getLastUpdateTime(), caches.match(request.url)]).then(([last_update_time, response]) => {
      if (response && last_update_time == response.headers.get(HEADER_CACHE_ID)) {
        return response;
      } else {
        return handleFetchDefault(request, e);
      }
    }));
  } else {
    e.respondWith(handleFetchDefault(request, e));
  }
});
