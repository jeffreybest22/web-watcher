// web-watcher — runner principal.
// Lit watches.json, surveille chaque info, alerte si nouvellement détectée, écrit docs/state.json.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchAllSources } from "./sources.js";
import { runSearches } from "./search.js";
import { judge } from "./judge.js";
import { alert, testNotify } from "./notify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WATCHES_FILE = join(ROOT, "watches.json");
const STATE_FILE = join(ROOT, "docs", "state.json");

const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD || 0.6);

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function runOne(watch, prevState) {
  console.log(`\n▶ ${watch.label} (${watch.id})`);
  const [sources, search] = await Promise.all([
    fetchAllSources(watch.sources || []),
    runSearches(watch.search_queries || []),
  ]);
  console.log(
    `  sources ok: ${sources.filter((s) => s.ok).length}/${sources.length} · ` +
      `recherche [${search.provider}]: ${search.results.length} résultats`
  );

  let verdict;
  try {
    verdict = await judge(watch, sources, search);
  } catch (e) {
    console.warn(`  [judge] échec: ${e.message}`);
    verdict = { found: false, confidence: 0, evidence_url: null, quote: null, summary: `Erreur juge: ${e.message}` };
  }
  console.log(
    `  verdict: ${verdict.found ? "TROUVÉ" : "rien"} (${Math.round(verdict.confidence * 100)}%) — ${verdict.summary}`
  );

  const detected = verdict.found && verdict.confidence >= CONFIDENCE_THRESHOLD;
  const wasAlerted = prevState?.alerted === true;

  let alertResults = null;
  if (detected && !wasAlerted) {
    console.log("  🔔 NOUVELLE détection → envoi des alertes…");
    alertResults = await alert(watch, verdict);
    console.log("  alertes:", JSON.stringify(alertResults));
  }

  return {
    id: watch.id,
    label: watch.label,
    status: detected ? "found" : "watching",
    alerted: wasAlerted || detected, // une fois alerté, on ne re-spamme pas
    confidence: verdict.confidence,
    evidence_url: verdict.evidence_url,
    quote: verdict.quote,
    summary: verdict.summary,
    last_checked: nowIso(),
    first_found_at: detected ? prevState?.first_found_at || nowIso() : null,
    search_provider: search.provider,
  };
}

async function main() {
  if (process.argv.includes("--test-notify")) {
    console.log("Test des canaux d'alerte…");
    console.log(JSON.stringify(await testNotify(), null, 2));
    return;
  }

  const watches = await loadJson(WATCHES_FILE, []);
  const prev = await loadJson(STATE_FILE, { watches: {} });
  const prevById = prev.watches || {};

  const results = {};
  for (const w of watches) {
    results[w.id] = await runOne(w, prevById[w.id]);
  }

  const state = { updated_at: nowIso(), watches: results };
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`\n✓ état écrit dans docs/state.json (${Object.keys(results).length} veilles)`);
}

main().catch((e) => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
