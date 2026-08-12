import os
from datetime import date, timedelta
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, session

import db
import coros_client
import coach

BASE_DIR = Path(__file__).parent
SECRET_KEY_FILE = BASE_DIR / "instance" / "secret_key"

if not SECRET_KEY_FILE.exists():
    SECRET_KEY_FILE.write_bytes(os.urandom(32))

app = Flask(__name__)
app.secret_key = SECRET_KEY_FILE.read_bytes()

db.init_db()


def _schedule_window():
    today = date.today()
    start = today - timedelta(days=365)
    end = today + timedelta(days=30)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


@app.route("/")
def index():
    return render_template("login.html", has_data=db.has_data())


@app.route("/api/login", methods=["POST"])
def api_login():
    payload = request.get_json(force=True)
    email = payload.get("email", "").strip()
    password = payload.get("password", "")

    if not email or not password:
        return jsonify({"status": "error", "message": "Email et mot de passe requis."}), 400

    try:
        token, user_id = coros_client.login_and_get_token(email, password)
    except coros_client.LoginError as e:
        return jsonify({"status": "error", "message": str(e)}), 401
    except Exception as e:
        return jsonify({"status": "error", "message": f"Erreur de connexion: {e}"}), 500

    session["token"] = token
    session["user_id"] = user_id

    return _run_scrape()


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    if "token" not in session:
        return jsonify({"status": "error", "message": "Session expirée, reconnecte-toi."}), 401
    return _run_scrape()


def _run_scrape():
    start, end = _schedule_window()
    try:
        result = coros_client.scrape_all(session["token"], session["user_id"], start, end)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Erreur pendant le scraping: {e}"}), 500

    db.save_scrape(result)
    return jsonify({"status": "ok", "activity_count": len(result["activities"])})


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@app.route("/api/data")
def api_data():
    return jsonify(db.get_dashboard_data())


@app.route("/api/analyse")
def api_analyse():
    return jsonify(db.get_analyse_data())


@app.route("/api/coach/weekly-digest", methods=["POST"])
def api_coach_weekly_digest():
    payload = request.get_json(silent=True) or {}
    user_note = (payload.get("user_note") or "").strip()[:2000]
    try:
        text = coach.generate_weekly_digest(user_note=user_note or None)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Erreur du coach local: {e}"}), 500
    return jsonify({"status": "ok", "text": text})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
