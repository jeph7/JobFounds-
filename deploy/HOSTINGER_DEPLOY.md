# Déploiement JOBFOUNDS — Hostinger Unlimited (Node.js hPanel) + Cloudflare (`jobfounds.com`)

Ce guide est adapté à votre formule **Hostinger Unlimited (Node.js managé dans hPanel)** avec votre domaine **`jobfounds.com`** géré sur **Cloudflare**. Aucune installation Nginx/PM2/SSH manuelle n’est nécessaire.

---

## Étape 1 — Mettre le projet sur GitHub (ou exporter en ZIP)
1. Depuis AI Studio, exportez le projet vers votre dépôt GitHub (privé ou public) ou téléchargez le ZIP du projet.
2. Vérifiez que le dépôt contient bien `package.json`, `server.ts`, `firebase-applet-config.json` et le dossier `src/`. *(Ne mettez jamais de fichier `.env` contenant des secrets dans Git.)*

---

## Étape 2 — Déployer en un clic dans Hostinger hPanel (Node.js)
1. Connectez-vous à **Hostinger hPanel → Sites Web → Ajouter un site → Node.js Web App** (ou **Gérer → Node.js** sur votre hébergement Unlimited).
2. **Source du projet** : collez le lien de votre dépôt **GitHub** (ou importez le ZIP).
3. **Paramètres de build & démarrage** :
   - **Version Node.js** : **`22.x` (obligatoire)** *(requis pour `node:sqlite` et l’exécution native de `server.ts`)*
   - **Domaine** : **`jobfounds.com`**
   - **Build command** : `npm run build`
   - **Start command** : `npm start` *(exécute `node server.ts`)*
4. **Variables d'environnement** (collez vos clés dans l’onglet **Environment Variables** d’Hostinger) :

| Variable | Valeur à mettre | Obligatoire ? |
|---|---|---|
| `NODE_ENV` | `production` | Oui |
| `APP_URL` | `https://jobfounds.com` | Oui |
| `GEMINI_API_KEY` | *(Votre clé Google AI Studio `AIza...`)* | **Oui** |
| `RESEND_API_KEY` | *(Votre clé Resend `re_...`)* | Optionnel (recommandé) |
| `NOTIFICATION_FROM_EMAIL` | `JOBFOUNDS <alerts@jobfounds.com>` | Si Resend activé |
| `ENGINE_WORKER_INTERVAL_MS` | `30000` | Recommandé |
| `ENGINE_DEFAULT_MONITOR_MINUTES` | `720` | Recommandé |
| `AI_DAILY_MAX_CALLS` | `100` | Recommandé |
| `AI_DAILY_MAX_COST_USD` | `3` | Recommandé |

5. Cliquez sur **Déployer / Deploy**.
   - Au premier démarrage, JOBFOUNDS initialise automatiquement la base SQLite (`data/jobfonds_engine.sqlite`), enregistre les 8 premières entreprises ATS officielles (Stripe, Datadog, Celonis, Adyen, Algolia, Alan, Linear, Spotify) et lance leur scan automatiquement.

---

## Étape 3 — Relier Cloudflare (`jobfounds.com`) à Hostinger
Dans **Hostinger hPanel → Tableau de bord / Détails du plan**, copiez l’**adresse IPv4** de votre hébergement Unlimited, puis allez dans **Cloudflare → `jobfounds.com` → DNS → Records** :

### A. Pointage du site vers Hostinger
- Type **`A`** | Name : **`@`** | Content : `<IP_HOSTINGER>` | **DNS Only (nuage gris)** le temps d’activer le SSL Hostinger
- Type **`A`** | Name : **`www`** | Content : `<IP_HOSTINGER>` | **DNS Only (nuage gris)** le temps d’activer le SSL Hostinger

*(Une fois le certificat SSL actif sur Hostinger hPanel → Sécurité → SSL, repassez `A @` et `A www` en **Proxied / nuage orange** dans Cloudflare, puis dans **Cloudflare → SSL/TLS → Overview**, mettez **`Full (strict)`** — jamais `Flexible`.)*

### B. Enregistrements e-mail Resend (si vous activez `alerts@jobfounds.com`)
- Ajoutez dans Cloudflare les enregistrements **MX** et **TXT (SPF, DKIM, DMARC)** donnés par Resend, tous en **DNS Only (nuage gris)**, puis cliquez sur **Verify** dans Resend.

---

## Étape 4 — Autoriser `jobfounds.com` dans Firebase (obligatoire)
Dans **Firebase Console → Authentication → Settings → Authorized domains** :
- Ajoutez **`jobfounds.com`**
- Ajoutez **`www.jobfounds.com`**

---

## Étape 5 — Vérifier que tout est en ligne
1. Ouvrez `https://jobfounds.com/api/health` → vérifiez :
   ```json
   {
     "ok": true,
     "engine": {
       "sqliteReady": true,
       "backgroundWorkerActive": true,
       "aiWithinBudget": true,
       "geminiConfigured": true,
       "emailConfigured": true
     }
   }
   ```
2. Ouvrez `https://jobfounds.com`, connectez-vous avec `guerrierjephly@gmail.com` → **Console Admin** pour vérifier les entreprises scannées et tester l’envoi d’e-mails Resend.
