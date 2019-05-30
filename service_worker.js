const ROOT = location.href.substring(0, location.href.lastIndexOf('/'));

const MANIFEST_URL = ROOT + '/manifest.json';

const CACHE_VERSION = 'v1';
const CACHE_ALWAYS_CHECK_LIST = [
  MANIFEST_URL,
];
const CACHE_NON_VOLATILE_LIST = [
  ROOT + '/archive/*',
  ROOT + '/images/szbus_*',
];
const CACHE_VERSIONED_LIST = {
  // Extra manifests are versioned by specific keys in the main manifest.
  [ ROOT + '/manifest_archives.json' ]: 'archives_version',

  // Bus data files are versioned by 'last_update_time' in the main manifest.
  [ ROOT + '/sz3.json'               ]: 'last_update_time',
  [ ROOT + '/sz4.json'               ]: 'last_update_time',
  [ ROOT + '/wj.json'                ]: 'last_update_time',
  [ ROOT + '/cs.json'                ]: 'last_update_time',
  [ ROOT + '/ks.json'                ]: 'last_update_time',
  [ ROOT + '/newbuses.csv'           ]: 'last_update_time',
};

const HEADER_CACHE_ID = 'X-Service-Worker-Cache-Id';
const HEADER_FALLBACK = 'X-Service-Worker-Fallback';

let gCachedManifest = null;

function urlMatch(url, list) {
  for (let pattern of list) {
    if (pattern.slice(-1) == '*') {
      let prefix = pattern.substring(0, pattern.length - 1);
      if (url.substring(0, prefix.length) == prefix)
        return true;
    } else {
      if (url == pattern)
        return true;
    }
  }
}

function forceRequestCacheRevalidation(request) {
  return new Request(request, {cache: 'no-cache'});
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

function fetchAndCache(request, e, versionKey) {
  let cachedManifestPromise = versionKey ? getCachedManifest() : Promise.resolve();
  return Promise.all([fetch(request), cachedManifestPromise]).then(([response, cachedManifest]) => {
    let clonedResponsePromise;
    if (cachedManifest && cachedManifest[versionKey]) {
      // Add a custom header to save the value of |versionKey| for later comparison.
      clonedResponsePromise = renewResponseAsync(response, {headers: {[HEADER_CACHE_ID]: cachedManifest[versionKey]}});
    } else {
      clonedResponsePromise = Promise.resolve(response.clone());
    }
    e.waitUntil(clonedResponsePromise.then(clonedResponse => caches.open(CACHE_VERSION).then(cache => cache.put(request, clonedResponse))));
    if (request.url == MANIFEST_URL) {
      response.clone().json().then(manifest => gCachedManifest = manifest);
    }
    return response;
  });
}

function handleVersionedFetch(request, e, versionKey) {
  // Fetch cached manifest and find cached copy of the request first.
  e.respondWith(Promise.all([getCachedManifest(), caches.match(request.url)]).then(([manifest, response]) => {
    // Check if HEADER_CACHE_ID matches the value in the manifest specified by |versionKey|.
    // Returns the matching response without fetching from the server.
    if (response && manifest && manifest[versionKey] && manifest[versionKey] == response.headers.get(HEADER_CACHE_ID)) {
      return response;
    } else {
      // Fetch a fresh new copy (force cache revalidation and avoid fetching a stale copy from the memory cache).
      return handleFetchDefault(forceRequestCacheRevalidation(request), e);
    }
  }));
}

function handleFetchDefault(request, e, versionKey) {
  // Fallback to cached copy but add a custom header to indicate this condition.
  return fetchAndCache(request, e, versionKey).catch(_ => caches.match(request).then(response =>
      response && renewResponseAsync(response, {headers: {[HEADER_FALLBACK]: 1}})) );
}

function getCachedManifest() {
  if (gCachedManifest)
    return Promise.resolve(gCachedManifest);
  return caches.match(new Request(MANIFEST_URL)).then(response => response ? response.json() : {}).then(manifest => gCachedManifest = manifest);
}

self.addEventListener('fetch', function(e) {
  let request = e.request;
  if (CACHE_ALWAYS_CHECK_LIST.includes(request.url)) {
    request = forceRequestCacheRevalidation(request);
  }

  if (urlMatch(request.url, CACHE_NON_VOLATILE_LIST)) {
    e.respondWith(caches.match(request).then(r => r || fetchAndCache(e.request, e)));
  } else if (CACHE_VERSIONED_LIST[request.url]) {
    let versionKey = CACHE_VERSIONED_LIST[request.url];
    // Fetch cached manifest and find cached copy of the request first.
    e.respondWith(Promise.all([getCachedManifest(), caches.match(request.url)]).then(([manifest, response]) => {
      // Check if HEADER_CACHE_ID matches the value in the manifest specified by |versionKey|.
      if (response && manifest && manifest[versionKey] && manifest[versionKey] == response.headers.get(HEADER_CACHE_ID)) {
        // Returns the matching response without fetching from the server.
        return response;
      } else {
        // Fetch a fresh new copy (force cache revalidation and avoid fetching a stale copy from the memory cache).
        return handleFetchDefault(forceRequestCacheRevalidation(request), e, versionKey);
      }
    }));
  } else {
    e.respondWith(handleFetchDefault(request, e));
  }
});
