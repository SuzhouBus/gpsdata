self.addEventListener('install', function(e) {
  if ('caches' in self) {
    e.waitUntil(
      caches.open('v1').then(function(cache) {
        return cache.addAll([
        ]);
      });
    );
  }
});
