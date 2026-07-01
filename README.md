# 🔭 web-watcher

Surveille le web et t'alerte quand une **information / annonce** est publiée — pas juste un changement de page, mais une vraie détection sémantique jugée par un LLM.

Exemples de veilles : *« L'API Natcash est enfin disponible »*, *« Visa République Dominicaine en ligne depuis Haïti »*.

## Comment ça marche

À chaque passage (cron GitHub Actions, toutes les 30 min), pour chaque veille de `watches.json` :

1. **Sources connues** — fetch des URLs officielles → texte.
2. **Recherche web** — lance les requêtes (DuckDuckGo gratuit, ou Brave/Tavily si clé).
3. **Juge LLM (Groq)** — décide si l'info est **concrètement annoncée** (preuve + URL), pas une rumeur. `found:true` seulement si confiance ≥ seuil.
4. **Alerte** — si nouvellement détecté : WhatsApp + Telegram + Email (canaux ignorés si non configurés). On n'alerte qu'**une fois** par veille.
5. **Dashboard** — `docs/state.json` commité → page GitHub Pages `docs/index.html`.

## Configurer les veilles

Édite `watches.json`. Chaque entrée :

```json
{
  "id": "identifiant-unique",
  "label": "Titre affiché",
  "question": "Question précise posée au LLM (avec critères stricts)",
  "sources": ["https://site-officiel.com"],
  "search_queries": ["requête 1", "requête 2"],
  "keywords": ["mot", "indice"]
}
```

La **question** est le cœur : sois précis sur ce qui compte comme « trouvé » (officiel, daté, concret) pour éviter les faux positifs.

## Lancer en local

```bash
npm install
cp .env.example .env   # remplis au moins GROQ_API_KEY
npm start              # un passage
npm run test:notify    # teste les canaux d'alerte configurés
```

## Déploiement (GitHub Actions)

1. Crée un repo (compte `jeffreybest22`, Actions OK) et pousse ce dossier.
2. **Settings → Secrets and variables → Actions** : ajoute au minimum `GROQ_API_KEY`, puis les canaux voulus (`TELEGRAM_*`, `OPENWA_*` + `WA_TO`, `SMTP_*` + `MAIL_TO`). Optionnel : `BRAVE_API_KEY` ou `TAVILY_API_KEY`.
3. **Settings → Pages** : source = branche `main`, dossier `/docs` → dashboard public.
4. Onglet **Actions** → lance `web-watcher` manuellement une fois pour vérifier.

## Secrets / variables

| Nom | Type | Obligatoire | Rôle |
|---|---|---|---|
| `GROQ_API_KEY` | secret | ✅ | Juge LLM |
| `GROQ_MODEL` | var | non | Défaut `llama-3.3-70b-versatile` |
| `CONFIDENCE_THRESHOLD` | var | non | Défaut `0.6` |
| `BRAVE_API_KEY` / `TAVILY_API_KEY` | secret | non | Recherche fiable (sinon DuckDuckGo) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | secret | non | Alerte Telegram |
| `OPENWA_URL` / `OPENWA_API_KEY` / `WA_TO` | secret | non | Alerte WhatsApp (Pi 5) |
| `SMTP_*` / `MAIL_TO` | secret | non | Alerte email |
