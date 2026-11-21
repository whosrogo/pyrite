// @ts-nocheck — scrapers ported as-is from the movies project
import { RotatingKey, fetchPageScripts, stringLiterals } from "./keys.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://vidspark.to";
// Sent as x-player-key; the API answers 401 when it's stale.
const PLAYER_KEY = new RotatingKey({
  name: "vidspark",
  env: "VIDSPARK_KEY",
  fallback: "3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13",
  discover: async () => (await fetchPageScripts(BASE + "/movie/550")).flatMap((c) => stringLiterals(c, "[0-9a-fA-F]{64}")),
});

// Pyrite addition: VidSpark hosts per-file subtitles at /api/vidora/subs<path>/<lang>.vtt?f=<file_code>.
// The source's `tracks` list is usually empty, so English is offered on spec; a 404 just drops it.
function vidsparkCaptions(source, path) {
  const listed = (source.tracks || [])
    .map((t) => ({ url: t.file || t.url, label: t.label || t.language || "", language: t.lang || t.srclang || "" }))
    .filter((t) => typeof t.url === "string" && /^https?:/.test(t.url));
  if (listed.length) return listed;
  if (!source.file_code) return [];
  const f = encodeURIComponent(source.file_code);
  return [{ url: `${BASE}/api/vidora/subs${path}/en.vtt?f=${f}`, label: "English", language: "en" }];
}

export async function vidsparkExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const path = isTV ? `/tv/${tmdbId}/${season}/${episode}` : `/movie/${tmdbId}`;

    const resp = await PLAYER_KEY.use(async (key) => {
      const r = await fetch(`${BASE}/api/vidora/v1${path}`, {
        headers: {
          "User-Agent": UA,
          Referer: BASE + path,
          "x-player-key": key,
        },
      });
      if (r.status === 401) throw new Error("api 401");
      return r;
    });
    const data = await resp.json().catch(() => null);
    if (!data?.result) throw new Error(data?.message || data?.error || "api " + resp.status);

    return (data.sources || [])
      .filter((s) => s?.url)
      .map((s) => ({
        url: s.url,
        type: s.url.includes(".m3u8") ? "hls" : "file",
        provider: "vidspark",
        providerName: "VidSpark",
        headers: { Referer: BASE + "/", Origin: BASE },
        captions: vidsparkCaptions(s, path),
      }));
  } catch (e) {
    console.log("[vidspark] error:", e.message);
    return [];
  }
}
