import json
import os
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

from flask import Flask, jsonify, redirect, render_template, request, session

import db
import coros_client
import coros_mcp_auth
import coros_mcp_client
import coach

BASE_DIR = Path(__file__).parent
SECRET_KEY_FILE = BASE_DIR / "instance" / "secret_key"
COROS_SESSION_FILE = BASE_DIR / "instance" / "coros_session.json"

if not SECRET_KEY_FILE.exists():
    SECRET_KEY_FILE.write_bytes(os.urandom(32))

app = Flask(__name__)
app.secret_key = SECRET_KEY_FILE.read_bytes()

db.init_db()


def _save_coros_session(token, user_id):
    # The Flask session cookie alone is too fragile for this (lost on browser
    # restart, cookie clearing, or simply a different browser/tab) — persisting
    # to disk means "Recharger les données" keeps working independently of it,
    # same as the MCP token in coros_mcp_auth.py.
    COROS_SESSION_FILE.write_text(json.dumps({"token": token, "user_id": user_id}))


def _load_coros_session():
    if not COROS_SESSION_FILE.exists():
        return None
    return json.loads(COROS_SESSION_FILE.read_text())


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
    _save_coros_session(token, user_id)

    return _run_scrape(token, user_id)


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    token, user_id = session.get("token"), session.get("user_id")
    if not token:
        saved = _load_coros_session()
        if not saved:
            return jsonify({"status": "error", "message": "Session expirée, reconnecte-toi."}), 401
        token, user_id = saved["token"], saved["user_id"]
        session["token"], session["user_id"] = token, user_id
    return _run_scrape(token, user_id)


def _run_scrape(token, user_id):
    start, end = _schedule_window()
    try:
        result = coros_client.scrape_all(token, user_id, start, end)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Erreur pendant le scraping: {e}"}), 500

    db.save_scrape(result)
    return jsonify({
        "status": "ok",
        "activity_count": len(result["activities"]),
        "mcp_connected": coros_mcp_auth.is_connected(),
    })


@app.route("/api/mcp/login/start")
def api_mcp_login_start():
    try:
        auth_url, pkce_state = coros_mcp_auth.start_authorization()
    except Exception as e:
        return jsonify({"status": "error", "message": f"Erreur de découverte OAuth: {e}"}), 500
    session["mcp_pkce"] = pkce_state
    return jsonify({"status": "ok", "auth_url": auth_url})


@app.route("/api/mcp/callback")
def api_mcp_callback():
    # Any failure here still lands on /dashboard rather than a bare error page —
    # the password/scraping half of the single login flow already succeeded and
    # its data is already in the DB, so stranding the user here would be worse
    # than just surfacing the MCP error as a dashboard status message.
    pkce_state = session.pop("mcp_pkce", None)
    if not pkce_state:
        return redirect("/dashboard?mcp_error=" + quote("Session d'autorisation expirée."))

    error = request.args.get("error")
    if error:
        return redirect("/dashboard?mcp_error=" + quote(f"Autorisation refusée par COROS: {error}"))

    try:
        coros_mcp_auth.complete_authorization(
            pkce_state, request.args.get("code"), request.args.get("state")
        )
    except coros_mcp_auth.McpAuthError as e:
        return redirect("/dashboard?mcp_error=" + quote(f"Erreur d'autorisation: {e}"))
    except Exception as e:
        return redirect("/dashboard?mcp_error=" + quote(f"Erreur pendant l'échange du token: {e}"))

    # The token is saved — redirect immediately rather than scraping here.
    # COROS's MCP server can take 8s+ per call, and scrape_all() makes ~8 of
    # them: doing that synchronously left the browser on a blank page for a
    # minute+ before it could even show /dashboard. The dashboard triggers the
    # actual data fetch itself (see ?mcp_connected=1 handling in app.js).
    return redirect("/dashboard?mcp_connected=1")


@app.route("/api/mcp/refresh", methods=["POST"])
def api_mcp_refresh():
    access_token = coros_mcp_auth.get_valid_access_token()
    if not access_token:
        return jsonify({"status": "error", "message": "Pas connecté via COROS MCP."}), 401
    try:
        db.save_mcp_scrape(coros_mcp_client.scrape_all(access_token))
    except Exception as e:
        return jsonify({"status": "error", "message": f"Erreur pendant le scraping MCP: {e}"}), 500
    return jsonify({"status": "ok"})


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
