# Guide de Déploiement — JOBFOUNDS sur Hostinger Unlimited (`jobfounds.com`)

Architecture adaptée au plan **Hostinger Unlimited** (**2 CPU · 3 Go RAM · 50 Go NVMe · Node.js 22 · Cron Jobs max 30 min · sans daemon permanent**).

---

## 1. Architecture Firebase Spark (gratuit) + Hostinger Unlimited

- **Services Firebase utilisés** : uniquement **Firebase Authentication** (Google Sign-In) et **Cloud Firestore** (comptes, profils, CV, candidatures CRM, offres employeurs, messagerie).
- **Services Firebase NON utilisés** : Firebase Storage (`0` import), Firebase Functions, Firebase Hosting, `firebase-admin` (aucun `FIREBASE_CLIENT_EMAIL` ni `FIREBASE_PRIVATE_KEY` requis).
- **Compatible forfait gratuit Spark** : **Oui** — Firebase Authentication + Cloud Firestore fonctionnent sur Spark sans facturation Google Cloud.
- **Configuration déjà présente** : `firebase-applet-config.json` contient déjà tous les paramètres Web Firebase du projet actuel (`gen-lang-client-0240072180`, base `ai-studio-jobfonds-f311037f-8fd3-4448-8bd1-d15f44d02af5`), ce qui préserve 100 % des comptes et données existants sans rien recréer.
- **Action unique dans Firebase Console** : dans *Authentication → Settings → Authorized domains*, ajoutez `jobfounds.com` et `www.jobfounds.com`.
- **Surcharge facultative** (uniquement si vous souhaitez connecter un autre projet Firebase Spark) : `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_DATABASE_ID` (ex. `(default)`), et `FIREBASE_PROJECT_ID` côté serveur.

---

## 2. Déploiement direct depuis GitHub ou par ZIP dans Hostinger hPanel

1. Ouvrez **Hostinger hPanel → Sites Web → Ajouter un site → Application Web Node.js**.
2. Associez le domaine **`jobfounds.com`** et activez le certificat **SSL HTTPS** automatique.
3. Choisissez **Importer depuis GitHub** (recommandé) ou **Importer une archive ZIP** (sans `node_modules/`, sans `.env`, sans `data/`).
4. Réglez les paramètres Node.js :
   - **Version Node.js** : `22.x` (`>= 22.14.0`, requis pour `node:sqlite`)
   - **Point d’entrée (`main`)** : `server.js` (compilé automatiquement depuis `server.ts`)
   - **Commande de build** : `npm run build` (compile le frontend `dist/` + `server.js` + `scripts/cron-worker.js`)
   - **Commande de démarrage** : `npm start` (exécute `node server.js`)

---

## 3. Variables d’environnement réellement utilisées (hPanel → Node.js → Variables d’environnement)

### Obligatoires
```env
NODE_ENV=production
APP_URL=https://jobfounds.com
GEMINI_API_KEY=votre_cle_api_gemini
```

### Recommandées pour Hostinger Unlimited (Cron Jobs + persistance SQLite hors build)
```env
WORKER_MODE=cron
CRON_SECRET=chaine_aleatoire_securisee_32_caracteres_minimum
JOBFOUNDS_DATA_DIR=/home/VOTRE_USER_HOSTINGER/jobfounds_data
```
> **Pourquoi `JOBFOUNDS_DATA_DIR` ?** En plaçant `jobfonds_engine.sqlite` dans `/home/VOTRE_USER_HOSTINGER/jobfounds_data` (en dehors du dossier de build/déploiement), toutes vos entreprises surveillées, offres, signaux, contacts RH, historiques et journaux **survivent à 100 %** aux redéploiements GitHub/ZIP et redémarrages Hostinger.

### Optionnelles (e-mails & quotas)
```env
RESEND_API_KEY=re_xxxxxxxxx
NOTIFICATION_FROM_EMAIL=JOBFOUNDS <alerts@jobfounds.com>
ENGINE_DEFAULT_MONITOR_MINUTES=720
AI_DAILY_MAX_CALLS=100
AI_DAILY_MAX_COST_USD=3
DEPLOY_VAULT_SECRET=chaine_aleatoire_securisee_32_caracteres
```

---

## 4. Configuration des Cron Jobs Hostinger (remplace le worker permanent)

Avec `WORKER_MODE=cron`, le serveur Web reste léger en RAM/CPU et ne maintient aucun timer infini. Le moteur de surveillance des entreprises, la file de tâches et les notifications sont exécutés proprement par un **Cron Job Hostinger** (plafonné automatiquement à 20–24 min < limite 30 min Hostinger, avec reprise automatique des tâches interrompues et garde-fou RAM à 1,8 Go < 3 Go).

Dans **hPanel → Avancé → Tâches Cron**, ajoutez **l’une des deux options** (recommandé : toutes les **15 minutes**, soit `*/15 * * * *`) :

### Option A — Cron CLI Node.js (recommandé, jusqu’à 20 min par cycle)
```bash
cd ~/domains/jobfounds.com/nodejs && npm run cron:tick
```

### Option B — Cron HTTP sécurisé (via `curl` + `CRON_SECRET`)
```bash
curl -fsS -X POST -H "X-Cron-Secret: VOTRE_CRON_SECRET" https://jobfounds.com/api/cron/tick
```

---

## 5. Vérification post-déploiement

Ouvrez `https://jobfounds.com/api/health` — vous devez obtenir :
```json
{
  "ok": true,
  "status": "ok",
  "engine": {
    "sqliteReady": true,
    "persistentExternalStorage": true,
    "workerMode": "cron",
    "cronEndpointConfigured": true,
    "geminiConfigured": true
  }
}
```
