# Baromètre des paris

Agrégateur de cotes de marchés de prédiction (**Polymarket**, **Kalshi**, **Manifold**),
toutes catégories, **lisible depuis la France**.

## Pourquoi ça marche depuis la France

Polymarket et Kalshi sont bloqués par DNS en France, et le navigateur refuse de toute façon
les appels directs (CORS). L'astuce : **la collecte ne se fait pas dans ton navigateur**.

```
GitHub Actions (serveurs US)  ──2×/jour──►  interroge les API en direct
        │                                    (ni blocage France, ni CORS)
        └──► écrit data.json dans le dépôt
                        │
   index.html (GitHub Pages) ──lit data.json en same-origin──►  s'affiche chez toi
```

Ton navigateur ne fait qu'un seul appel : `data.json`, servi par le même site. Rien à débloquer.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | la page (onglets de catégorie, recherche sur tout le catalogue, 3 sources) |
| `fetch.mjs` | le collecteur Node (appelle les API, écrit `data.json`) |
| `.github/workflows/update.yml` | le robot : cron 2×/jour + bouton manuel + 1er push |
| `data.json` | les cotes (régénéré par le robot ; un instantané de départ est inclus) |

## Mise en route (~10 min, une seule fois)

1. **Crée un dépôt GitHub** (perso, pas pro). Public = GitHub Pages gratuit.
   *(Pages sur dépôt privé = compte Pro.)*

2. **Pousse ce dossier** dedans :
   ```bash
   cd ~/Desktop/barometre-paris
   git init
   git add .
   git commit -m "Baromètre des paris"
   git branch -M main
   git remote add origin https://github.com/<TON_PSEUDO>/<TON_REPO>.git
   git push -u origin main
   ```

3. **Active GitHub Pages** : repo → **Settings → Pages** →
   *Source* = **GitHub Actions**. (Rien d'autre à cocher : le workflow fourni déploie lui-même.)
   La page sera sur `https://<TON_PSEUDO>.github.io/<TON_REPO>/`.

4. **Laisse tourner le robot** : le premier `push` lance le workflow *Update odds* (onglet **Actions**),
   qui collecte les cotes puis publie la page en ~40 s, puis repasse à **07:00 et 19:00 UTC**.
   Pour forcer une mise à jour : Actions → *Update odds* → **Run workflow**.

   Le workflow a deux jobs : **build** (lance `fetch.mjs`, assemble `index.html` + `data.json`)
   et **deploy** (publie sur Pages). La collecte n'est pas committée dans le dépôt — elle part
   directement dans le site déployé, donc le `data.json` du dépôt reste l'instantané de départ.

## Aperçu en local

`file://` empêche le navigateur de lire `data.json`. Lance un petit serveur :

```bash
cd ~/Desktop/barometre-paris
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

## Réglages

- **Fréquence** : la ligne `cron` dans `update.yml` (`0 7,19 * * *` = 2×/jour UTC).
  Plus souvent = `0 */6 * * *` (toutes les 6 h), etc.
- **Catégories / profondeur** : le tableau `CATS` et les `.slice(0, 45)` dans `fetch.mjs`.
- **Catégories affichées** : le tableau `CATS` en haut du `<script>` de `index.html`.

Cotes indicatives — pas un conseil d'investissement.
