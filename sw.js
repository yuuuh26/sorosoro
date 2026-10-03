const CACHE='sorosoro-cloud-v1.4.0';
const SHELL=['./','./index.html','./styles-v130.css?v=1.4.0','./js/app-v130.js?v=1.4.0','./js/cloud.mjs?v=1.4.0','./js/snapshot.mjs','./js/cloud-store.mjs','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-maskable-192.png','./assets/icon-maskable-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sorosoro-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  // Never cache authentication, record responses, or other apps' content.
  if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/'))return;
  const path=url.pathname.slice(new URL('./',self.location.href).pathname.length);
  if(!['','index.html','styles-v130.css','js/app-v130.js','js/cloud.mjs','js/snapshot.mjs','js/cloud-store.mjs','manifest.webmanifest','assets/icon-192.png','assets/icon-512.png','assets/icon-maskable-192.png','assets/icon-maskable-512.png'].includes(path))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)));}return r;}).catch(async()=>await caches.match(e.request)||(e.request.mode==='navigate'?await caches.match('./index.html'):Response.error())));
});
