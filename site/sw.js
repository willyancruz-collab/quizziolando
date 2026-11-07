const CACHE_NAME = "quizziolando-shell-v25";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./css/style.css?v=20261106-wide-form",
  "./css/style.css?v=academic-catalog-1",
  "./css/style.css?v=ai-import-compact-print-1",
  "./app.js",
  "./firebase-config.js",
  "./js/firebase-config.js",
  "./js/professor.js?v=ai-import-compact-print-1",
  "./js/aluno.js",
  "./js/app-shell.js?v=20261106-wide-form",
  "./js/classroom-interactions.js",
  "./js/access-monitor.js",
  "./js/sound-effects.js",
  "./js/tutorial.js",
  "./js/master-control.js",
  "./js/pdf-prova.js?v=ai-import-compact-print-1",
  "./professor/dashboard.html",
  "./professor/criar-quiz.html",
  "./professor/criar-prova.html",
  "./professor/respostas-formulario.html",
  "./professor/aulas-atividades.html",
  "./professor/bi.html",
  "./professor/registros.html",
  "./professor/controle-master.html",
  "./aluno/join.html",
  "./aluno/jogar.html",
  "./aluno/minhas-provas.html",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
