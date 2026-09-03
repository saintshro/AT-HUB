const C='athub-shell-v1-5-1';
const A=['./','index.html','hub.css','hub-sync.js','translogistik.html','privat.html','projekte-wissen.html','siggi.html','einstellungen-hub.html','finanzen.html','styles.css','app.js','finance-core-v8.8.1.js','finance-ui-v8.9.js','config.json','manifest.webmanifest','arbeitszeit.html','arbeitszeit.js','worktime-seed-2026.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(C).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request)));});
