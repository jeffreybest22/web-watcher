// Fetch des URLs officielles et extraction du texte lisible.
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Récupère le texte d'une page (best-effort, ne casse pas le run si une source échoue).
export async function fetchSourceText(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "fr,en,es;q=0.8" },
      signal: ctrl.signal,
    });
    if (!res.ok) return { url, ok: false, error: `HTTP ${res.status}`, text: "" };
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, svg").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();
    return { url, ok: true, text: text.slice(0, 8000) };
  } catch (e) {
    return { url, ok: false, error: String(e.message || e), text: "" };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchAllSources(urls = []) {
  return Promise.all(urls.map((u) => fetchSourceText(u)));
}
