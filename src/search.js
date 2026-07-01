// Recherche web. Utilise Brave ou Tavily si une clé est fournie, sinon DuckDuckGo HTML (sans clé).
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function searchBrave(query, count = 6) {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
    { headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY } }
  );
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = await res.json();
  return (data.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description || "",
  }));
}

async function searchTavily(query, count = 6) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: count,
      search_depth: "basic",
    }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content || "",
  }));
}

async function searchDuckDuckGo(query, count = 6) {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const out = [];
  $(".result").each((_, el) => {
    if (out.length >= count) return;
    const a = $(el).find(".result__a").first();
    const title = a.text().trim();
    let url = a.attr("href") || "";
    // DDG enveloppe parfois l'URL dans un redirect uddg=
    const m = url.match(/[?&]uddg=([^&]+)/);
    if (m) url = decodeURIComponent(m[1]);
    const snippet = $(el).find(".result__snippet").text().trim();
    if (title && url) out.push({ title, url, snippet });
  });
  return out;
}

function provider() {
  if (process.env.BRAVE_API_KEY) return ["brave", searchBrave];
  if (process.env.TAVILY_API_KEY) return ["tavily", searchTavily];
  return ["duckduckgo", searchDuckDuckGo];
}

// Lance plusieurs requêtes et déduplique par URL.
export async function runSearches(queries = []) {
  const [name, fn] = provider();
  const seen = new Set();
  const results = [];
  for (const q of queries) {
    try {
      const hits = await fn(q);
      for (const h of hits) {
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        results.push({ ...h, query: q });
      }
    } catch (e) {
      console.warn(`  [search:${name}] "${q}" → ${e.message}`);
    }
    // petite pause pour ne pas se faire bloquer (surtout DDG)
    await new Promise((r) => setTimeout(r, 800));
  }
  return { provider: name, results };
}
