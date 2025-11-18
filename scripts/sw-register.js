(() => {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const protocol = window.location.protocol;
  const isSecureContext = protocol === 'https:' || protocol === 'http:';
  if (!isSecureContext) {
    console.info('Skipping service worker registration for protocol:', protocol);
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js')
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
})();
