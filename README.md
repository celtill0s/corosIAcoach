# COROS Data

Petite app web locale pour récupérer tes données COROS Training Hub (activités,
charge d'entraînement, VO2max, FC repos...) et les visualiser dans un dashboard.

## Comment ça marche

1. Tu ouvres la page de connexion et entres ton e-mail / mot de passe COROS.
2. Le serveur lance un navigateur headless (Playwright + Firefox) qui se
   connecte à `trainingeu.coros.com` à ta place, récupère le jeton de session,
   puis interroge directement les APIs internes de COROS (`activity/query`,
   `dashboard/query`, `analyse/query`, `training/schedule/query`).
3. Les données sont enregistrées dans une base SQLite locale
   (`data/coros_data.sqlite`).
4. Tu es redirigé vers `/dashboard`, qui affiche les données depuis la base
   sur deux onglets :
   - **Tableau de bord** : cartes de synthèse, charge d'entraînement (90j),
     VO2max/FC repos, rendement 7 jours, activité hebdomadaire, tableaux de
     zones (FC seuil / allure seuil), VFC nocturne, records personnels
     (course/vélo, dérivés des résumés d'activité), prédicteur de course
     (estimation approximative via formule de Riegel — pas le modèle interne
     COROS), et la liste des activités récentes.
   - **Analyse des données** : réplique de l'onglet COROS du même nom (récap
     4 semaines, charge/ratio d'achèvement 12 semaines, VO2max, FC repos,
     charge hebdomadaire, distribution d'intensité, répartition par zones
     d'allure/distance/FC).

Un bouton "Recharger les données" sur le dashboard relance le scraping sans
redemander le mot de passe (le jeton de session est gardé le temps de la
session navigateur).

## Sécurité — pas de mot de passe stocké

- Le mot de passe saisi dans le formulaire n'est **jamais écrit sur disque**.
  Il transite en mémoire le temps d'une requête HTTP (`POST /api/login`),
  sert à la connexion Playwright, puis est jeté.
- Seul le jeton de session COROS (pas le mot de passe) est conservé, dans un
  cookie de session signé côté navigateur (`SECRET_KEY` généré une fois dans
  `instance/secret_key`, à ne pas partager).
- Aucune donnée de sommeil n'est disponible via ce portail (Training Hub =
  coaching/performance, pas l'app grand public) — si besoin, il faudra un
  autre accès (API COROS Open ou export depuis l'app mobile).
- Cette app est prévue pour un usage **local uniquement**
  (`127.0.0.1:5000`). Ne pas l'exposer sur internet telle quelle : le serveur
  de dev Flask n'est pas fait pour la production, et le formulaire de login
  envoie le mot de passe en clair sur la connexion HTTP (sans souci en local,
  risqué sur un réseau non fiable).

## Prise en main (nouvel utilisateur / nouvelle machine)

### Prérequis

- Python 3.10+ (`python3 --version`)
- Un compte COROS avec accès à `trainingeu.coros.com` (Training Hub)
- ~500 Mo d'espace disque (dépendances + navigateur headless)

### Installation

```bash
cd ~/Documents/Coros          # ou l'emplacement où tu as copié le projet
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/playwright install firefox   # télécharge Firefox headless pour Playwright
```

### Lancer l'app

```bash
cd ~/Documents/Coros
./venv/bin/python app.py
```

Puis ouvrir http://127.0.0.1:5000 dans le navigateur, entrer tes identifiants
COROS, et attendre la fin du scraping (10-30s) pour arriver sur le dashboard.

Rien n'est préconfiguré par utilisateur : la base `data/coros_data.sqlite` et
la clé de session `instance/secret_key` sont créées automatiquement au premier
lancement, propres à chaque installation.

### Fonctionnalité Coach (LLM local, optionnelle)

Le coach IA tourne en local via [Ollama](https://ollama.com), aucune donnée
n'est envoyée à un service externe.

```bash
curl -fsSL https://ollama.com/install.sh | sh   # installe Ollama (demande sudo)

# Désactiver le démarrage automatique du service (on ne veut pas qu'il tourne
# en permanence en arrière-plan) :
sudo systemctl stop ollama
sudo systemctl disable ollama

# Télécharger le modèle (~4.7 Go, une seule fois) :
ollama serve &          # démarre Ollama manuellement le temps du téléchargement
ollama pull qwen2.5:7b-instruct
```

Ensuite, l'app démarre et arrête Ollama elle-même à la demande depuis
l'onglet **Coach** — pas besoin de le laisser tourner en permanence.

## Coach IA (local)

Onglet "Coach" du dashboard : bouton "Générer mon point coaching" qui envoie
un résumé des 14 derniers jours (charge, ratio de charge, fatigue, VO2max,
FC repos, activités) à Qwen2.5:7b-instruct via Ollama, et affiche un
commentaire de coaching en retour.

- **100% local** : aucune donnée n'est envoyée à un service externe (contrairement
  à une intégration Claude/GPT). Tout se passe entre Flask et Ollama sur
  `127.0.0.1:11434`.
- **Accès strict** : le modèle ne reçoit que le texte construit par
  `coach._build_weekly_context()` à partir de `db.py` — pas d'accès fichier,
  pas d'accès shell, pas de tool avec un périmètre plus large que ce projet.
- **À la demande uniquement** : `coach._ensure_running()` démarre `ollama serve`
  seulement s'il ne tourne pas déjà, et l'arrête juste après (sauf s'il tournait
  déjà avant l'appel). Rien ne persiste en arrière-plan entre deux utilisations.
- **Limite connue** : un modèle 7B local est correct pour synthétiser des
  chiffres déjà calculés, mais moins fin qu'un modèle frontière pour arbitrer
  des signaux contradictoires (ex: VFC en baisse + charge élevée + course
  proche). À garder en tête pour des décisions importantes. Voir `coach.py`
  pour changer de modèle (`qwen2.5:14b-instruct` par ex.) si besoin de plus
  de finesse.

## Structure du projet

```
Coros/
├── app.py              # Routes Flask (login, scraping, dashboard, API JSON)
├── coros_client.py      # Connexion Playwright + appels aux APIs COROS
├── db.py                 # Schéma et accès SQLite
├── coach.py               # Coach IA local (Ollama + Qwen2.5), accès strict à db.py
├── templates/
│   ├── login.html        # Formulaire de connexion
│   └── dashboard.html     # Page de visualisation
├── static/
│   ├── style.css
│   └── app.js            # Fetch API + rendu des graphiques (Chart.js)
├── data/
│   └── coros_data.sqlite # Base de données (créée au premier scraping)
└── instance/
    └── secret_key         # Clé de session Flask (générée automatiquement)
```

## Base de données

Quatre tables dans `data/coros_data.sqlite` :

- `activities` — une ligne par séance (date, distance, durée, FC moyenne,
  dénivelé, charge d'entraînement, appareil...), avec le JSON brut complet
  dans `raw_json` pour les champs non exposés en colonnes.
- `daily_analysis` — une ligne par jour (charge, fatigue, VO2max, FC repos
  testée, ratio de charge, tendance de forme...).
- `raw_snapshots` — blob JSON complet par endpoint (`dashboard`,
  `dashboard_detail`, `cycle_record`, `analyse`, `schedule`,
  `schedule_summary`, `profile_private`, `profile_public`) : couvre
  l'intégralité des données renvoyées par COROS, y compris les champs pas
  encore exploités dans l'UI.

## Limites connues

- **Sommeil détaillé** (stades, durée) : absent de ce portail (Training Hub =
  coaching/performance, pas l'app grand public).
- **Records 1km/3km/5km/10km** : non calculables sans les données de
  laps/splits par activité (non scrapées ici) — seuls "distance la plus
  longue" et "dénivelé max" sont dérivés (des résumés d'activité).
- **Prédicteur de course** : approximation par formule de Riegel à partir de
  ta meilleure perf récente, pas le modèle propriétaire COROS — assez fiable
  sur 5-10km, diverge davantage sur semi/marathon.
- **Détail par activité** (tracé GPS, laps, zones seconde par seconde) : pas
  scrapé (chantier séparé, ~252 appels supplémentaires).

## Pour la suite

Idées d'évolutions possibles sur cette base :
- Historique multi-snapshots au lieu d'un seul `raw_snapshots` "latest" par clé.
- Scraping automatique périodique (cron) au lieu du bouton manuel.
- Filtres/sélecteurs de période sur le dashboard.
- Export CSV depuis l'interface.
- Détection et alerte sur les tendances (fatigue, charge trop élevée...).
- Scraping du détail par activité si besoin des tracés/laps.
