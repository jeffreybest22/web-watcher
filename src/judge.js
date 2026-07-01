// Juge LLM (Groq, API compatible OpenAI) : décide si l'information surveillée est VRAIMENT annoncée.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const SYSTEM = `Tu es un analyste de veille rigoureux. On te donne une QUESTION de surveillance et une liste d'INDICES (résultats de recherche web + extraits de pages officielles).
Ta tâche : déterminer si l'information demandée est CONCRÈTEMENT et OFFICIELLEMENT disponible/annoncée MAINTENANT.

Règles strictes :
- "found": true UNIQUEMENT s'il existe une preuve concrète et crédible (annonce officielle, portail en ligne réel, documentation, article daté récent).
- "found": false si c'est une rumeur, une vieille information, une page non pertinente, une simple intention/projet futur, ou si rien de probant.
- En cas de doute, réponds false. Mieux vaut rater une fois que crier au loup.
- "confidence" entre 0 et 1.
- "evidence_url" = l'URL la plus probante (ou null).
- "quote" = courte citation/extrait qui prouve (ou null).
- "summary" = 1-2 phrases en français expliquant ta décision.

Réponds UNIQUEMENT en JSON valide, sans texte autour :
{"found": bool, "confidence": number, "evidence_url": string|null, "quote": string|null, "summary": string}`;

function buildUserPrompt(watch, sources, search) {
  const lines = [];
  lines.push(`QUESTION DE SURVEILLANCE: ${watch.question}`);
  if (watch.keywords?.length) lines.push(`Mots-clés indicatifs: ${watch.keywords.join(", ")}`);
  lines.push("");
  lines.push("=== RÉSULTATS DE RECHERCHE WEB ===");
  if (!search.results.length) lines.push("(aucun)");
  for (const r of search.results.slice(0, 12)) {
    lines.push(`- ${r.title}\n  ${r.url}\n  ${(r.snippet || "").slice(0, 300)}`);
  }
  lines.push("");
  lines.push("=== EXTRAITS DES SOURCES OFFICIELLES SURVEILLÉES ===");
  const okSources = sources.filter((s) => s.ok && s.text);
  if (!okSources.length) lines.push("(aucune source accessible)");
  for (const s of okSources) {
    lines.push(`[${s.url}]\n${s.text.slice(0, 2500)}`);
  }
  return lines.join("\n");
}

export async function judge(watch, sources, search) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY manquante");
  }
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserPrompt(watch, sources, search) },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { found: false, confidence: 0, evidence_url: null, quote: null, summary: "Parse error" };
  }
  return {
    found: !!parsed.found,
    confidence: Number(parsed.confidence) || 0,
    evidence_url: parsed.evidence_url || null,
    quote: parsed.quote || null,
    summary: parsed.summary || "",
  };
}
