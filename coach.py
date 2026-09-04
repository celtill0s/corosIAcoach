import subprocess
import time

import requests

import db

OLLAMA_URL = "http://127.0.0.1:11434"
MODEL = "qwen2.5:7b-instruct"

# Exact category labels handed to the model — it must reuse these verbatim rather
# than guessing a sport category from the free-text activity name (it previously
# mislabeled a "Gravel Bike" activity as "VTT", which is a different discipline).
SPORT_CATEGORIES = {
    100: "Course à pied", 101: "Course à pied (indoor)", 102: "Trail",
    103: "Course à pied (fractionné)", 104: "Randonnée",
    200: "Vélo (route)", 203: "Vélo (gravel)", 204: "Vélo (VTT)",
    301: "Natation (eau libre)", 400: "Cardio salle", 402: "Renforcement",
    500: "Ski", 704: "Kayak", 900: "Marche", 9807: "Snorkeling",
    9904: "Musculation", 10001: "Multisport",
}

SYSTEM_PROMPT = """Tu es un coach sportif spécialisé en endurance (course à pied, vélo, trail).
Tu analyses les données d'entraînement d'un athlète et donnes des conseils concrets et bienveillants.

Règles strictes :
- Base-toi uniquement sur les données fournies dans le message, n'invente jamais de chiffres.
- N'invente et ne reformule JAMAIS le nom d'une activité ou sa catégorie de sport. Utilise
  exactement la "catégorie" fournie entre parenthèses pour chaque activité (par exemple ne
  jamais dire "VTT" si la catégorie indiquée est "Vélo (gravel)" — ce sont des disciplines
  différentes).
- Utilise les bandes de charge recommandée déjà calculées (charge cible min/max) comme référence,
  ne recalcule pas de seuils physiologiques toi-même.
- Si l'athlète écrit un message libre (question, envie précise, état de santé...), c'est la
  PRIORITÉ absolue de ta réponse : réponds d'abord à ça, directement, avant toute chose. Ne te
  réfugie jamais dans un résumé générique de charge/fatigue pour éviter de répondre à une
  question précise. Ce message ne doit jamais te faire inventer ou modifier une donnée objective
  (charge, distance, FC...), mais il doit changer CE DONT TU PARLES.
- Si ce message mentionne un état de santé (rhume, douleur, blessure, fatigue inhabituelle...),
  acknowledge-le explicitement et adapte ton conseil en conséquence (ex: rester prudent sur
  l'intensité en cas de rhume, encore plus si les symptômes descendent sous la gorge — fièvre,
  toux profonde, essoufflement anormal).
- Tu n'es pas médecin : pas de diagnostic médical, invite à consulter un professionnel de santé
  en cas de signal inquiétant (douleur, fatigue extrême persistante...).
- Sois concis dans ta réponse finale (200 mots maximum), concret, et priorise 1-2 points
  d'attention plutôt qu'une liste exhaustive.
- Réponds en français.

Méthode de travail — fais ça avant de répondre :
1. Sous le titre "## Analyse" (visible), passe en revue chaque signal un par un (charge et
   ratio de charge jour par jour, tendance de la fatigue, VO2max, FC repos, activités notables,
   sommeil et stress quotidien si disponibles, ressenti rapporté s'il y en a un) et note ce que
   chacun indique isolément.
2. Croise ensuite ces signaux : est-ce qu'ils se confirment ou se contredisent ? Quel est le
   signal le plus fiable si conflit ?
3. Seulement après cette analyse, écris ta réponse finale sous le titre exact "## Réponse".
   C'est cette section, et uniquement elle, qui sera montrée à l'athlète.
"""


def _is_running():
    try:
        requests.get(OLLAMA_URL, timeout=1)
        return True
    except requests.exceptions.RequestException:
        return False


def _ensure_running():
    """Starts Ollama if it isn't already running. Returns True if this call started it
    (so the caller knows whether it's responsible for stopping it afterwards)."""
    if _is_running():
        return False
    subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(30):
        if _is_running():
            return True
        time.sleep(0.5)
    raise RuntimeError("Impossible de démarrer Ollama (timeout).")


def _stop():
    subprocess.run(["pkill", "-f", "ollama serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _chat(messages):
    resp = requests.post(f"{OLLAMA_URL}/api/chat", json={
        "model": MODEL,
        "messages": messages,
        "stream": False,
        # The chain-of-thought "## Analyse" section roughly doubles output length —
        # give it enough room to not get cut off before reaching "## Réponse".
        "options": {"num_predict": 1500},
    }, timeout=300)
    resp.raise_for_status()
    return resp.json()["message"]["content"]


def _extract_final_answer(raw_text):
    """The model is asked to reason under '## Analyse' before answering under '## Réponse' —
    only the latter is meant for the athlete. Falls back to the full text if the model
    didn't follow the format, so nothing is silently lost."""
    marker = "## Réponse"
    idx = raw_text.find(marker)
    if idx == -1:
        return raw_text
    return raw_text[idx + len(marker):].lstrip(" :\n")


def _build_weekly_context():
    """Pulls the last 14 days strictly from the local Coros SQLite database (db.py) —
    no filesystem or network access beyond this project's own data."""
    data = db.get_dashboard_data()
    daily = data["daily"][-14:]
    if not daily:
        return None

    start_day = daily[0]["happen_day"]
    activities = [a for a in data["activities"] if a["date"] >= start_day]

    lines = ["Charge et forme, 14 derniers jours (un point par jour) :"]
    for d in daily:
        lines.append(
            f"- {d['happen_day']}: charge={d['training_load']}, "
            f"ratio_charge={d['training_load_ratio']}, fatigue={d['tired_rate']}, "
            f"VO2max={d['vo2max']}, FC_repos={d['test_rhr']}"
        )

    lines.append("\nActivités sur la période :")
    for a in sorted(activities, key=lambda x: x["date"]):
        category = SPORT_CATEGORIES.get(a["sport_type"], f"Sport {a['sport_type']}")
        lines.append(
            f"- {a['date']} \"{a['name']}\" (catégorie: {category}): {a['distance'] / 1000:.1f} km, "
            f"{a['total_time'] // 60} min, FC moy {a['avg_hr']}, charge {a['training_load']}"
        )

    # Sourced from the COROS MCP connection (coros_mcp_client.py) — only present if
    # the user connected via "Se connecter via COROS (MCP)" on the login page.
    sleep = [s for s in data.get("sleep", []) if s["wake_day"] >= start_day]
    if sleep:
        lines.append("\nSommeil, 14 derniers jours (nuit attribuée au jour de réveil) :")
        for s in sleep:
            lines.append(
                f"- {s['wake_day']}: score={s['sleep_score']}, durée={s['main_sleep_minutes']} min, "
                f"profond={int((s['deep_ratio'] or 0) * 100)}%, léger={int((s['light_ratio'] or 0) * 100)}%, "
                f"REM={int((s['rem_ratio'] or 0) * 100)}%"
            )

    health = [h for h in data.get("daily_health", []) if h["day"] >= start_day]
    if health:
        lines.append("\nStress quotidien (moyenne journalière), 14 derniers jours :")
        for h in health:
            lines.append(f"- {h['day']}: stress_moyen={h['stress_avg']}")

    return "\n".join(lines)


def generate_weekly_digest(user_note=None):
    context = _build_weekly_context()
    if context is None:
        return "Pas assez de données pour générer un point coaching. Recharge tes données d'abord."

    prompt = f"Voici mes données d'entraînement récentes (contexte) :\n\n{context}\n\n"

    if user_note:
        prompt += (
            f"Ce que je te dis directement, là, maintenant :\n\"{user_note}\"\n\n"
            "Réponds D'ABORD et PRINCIPALEMENT à ça — c'est ma vraie question/demande. "
            "Les données ci-dessus ne sont qu'un contexte pour étayer ta réponse, pas le sujet "
            "principal : ne me ressers pas un résumé générique de charge/fatigue si je te "
            "demande autre chose."
        )
    else:
        prompt += (
            "Fais-moi un point coaching sur ma semaine : ce qui va bien, ce à quoi faire attention, "
            "et une recommandation concrète pour les prochains jours."
        )

    started_by_us = _ensure_running()
    try:
        raw = _chat([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ])
        return _extract_final_answer(raw)
    finally:
        if started_by_us:
            _stop()
