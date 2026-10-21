// LinkedIn Kommentator – Background Service Worker
// Leitet Anfragen an den lokalen Server weiter und cacht Ergebnisse pro Post.

const SERVER = "http://127.0.0.1:8787";
const CACHE_KEY = "suggestionCache";
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 Tage
const CACHE_MAX = 200;
const UNREACHABLE = "Server nicht erreichbar. Bitte im Terminal im Ordner server/ `npm start` ausführen und das Fenster offen lassen.";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "suggest") {
    handleSuggest(msg).then(sendResponse);
    return true; // asynchrone Antwort
  }
  if (msg?.type === "health") {
    health().then(sendResponse);
    return true;
  }
});

async function handleSuggest({ cacheKey, payload, force }) {
  if (!force && cacheKey) {
    const hit = await cacheGet(cacheKey);
    if (hit) return { ok: true, suggestions: hit, cached: true };
  }

  let res;
  try {
    res = await fetch(`${SERVER}/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: UNREACHABLE };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {}

  if (!res.ok || !Array.isArray(data?.suggestions)) {
    return { ok: false, error: data?.error || `Server-Fehler (${res.status}).`, serverVersion: data?.version };
  }

  if (cacheKey) await cacheSet(cacheKey, data.suggestions);
  return { ok: true, suggestions: data.suggestions, cached: false, serverVersion: data.version };
}

async function health() {
  try {
    const res = await fetch(`${SERVER}/health`);
    return await res.json();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

async function readCache() {
  const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
  return cache && typeof cache === "object" ? cache : {};
}

async function cacheGet(key) {
  const cache = await readCache();
  const entry = cache[key];
  if (!entry || Date.now() - entry.t > CACHE_TTL_MS) return null;
  return entry.suggestions;
}

async function cacheSet(key, suggestions) {
  const cache = await readCache();
  const now = Date.now();
  for (const k of Object.keys(cache)) if (now - cache[k].t > CACHE_TTL_MS) delete cache[k];
  cache[key] = { t: now, suggestions };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys
      .sort((a, b) => cache[a].t - cache[b].t)
      .slice(0, keys.length - CACHE_MAX)
      .forEach((k) => delete cache[k]);
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}
