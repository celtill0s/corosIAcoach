import json

import requests
from playwright.sync_api import sync_playwright

LOGIN_URL = "https://trainingeu.coros.com/admin/views/dash-board"
API_BASE = "https://teameuapi.coros.com"


class LoginError(Exception):
    pass


def login_and_get_token(email, password):
    """Logs into COROS Training Hub with a headless browser and returns (token, user_id).
    The password is only ever held in memory for the duration of this call."""
    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)

        page.get_by_placeholder("E-mail").fill(email)
        page.get_by_placeholder("Please enter password with 6-20 characters").fill(password)
        # Scoped to .login-privacy-row: COROS added a second checkbox ("remember me",
        # .login-remember-row) that also matches .arco-checkbox-icon, which made the
        # bare selector ambiguous (Playwright strict-mode error).
        page.locator(".login-privacy-row .arco-checkbox-icon").click()

        # The submit button stays disabled until Vue re-renders after the checkbox
        # click; clicking too early is a silent no-op, so wait for it to enable.
        page.wait_for_selector("button[type=submit]:not(.arco-btn-disabled)", timeout=5000)
        page.locator("button[type=submit]").click()

        try:
            page.wait_for_url(lambda url: "/login" not in url, timeout=15000)
        except Exception:
            pass
        page.wait_for_load_state("networkidle", timeout=30000)

        if "/login" in page.url:
            browser.close()
            raise LoginError("Identifiants refusés par COROS.")

        token = None
        for c in page.context.cookies():
            if c["name"] == "CPL-coros-token":
                token = c["value"]
        browser.close()

    if not token:
        raise LoginError("Connexion réussie mais token introuvable.")

    user_id = _fetch_user_id(token)
    return token, user_id


def _fetch_user_id(token):
    resp = requests.get(
        f"{API_BASE}/account/query",
        headers={"accesstoken": token, "User-Agent": "Mozilla/5.0"},
        timeout=20,
    )
    resp.raise_for_status()
    return str(resp.json()["data"]["userId"])


def _session(token, user_id):
    s = requests.Session()
    s.headers.update({
        "accesstoken": token,
        "yfheader": json.dumps({"userId": user_id}),
        "User-Agent": "Mozilla/5.0",
    })
    return s


def _get(session, path, params=None):
    resp = session.get(f"{API_BASE}{path}", params=params, timeout=20)
    resp.raise_for_status()
    return resp.json()


def fetch_all_activities(session):
    activities = []
    page_number = 1
    size = 50
    while True:
        body = _get(session, "/activity/query", {"size": size, "pageNumber": page_number, "modeList": ""})
        data = body.get("data", {})
        chunk = data.get("dataList", [])
        activities.extend(chunk)
        if not chunk or len(activities) >= data.get("count", 0):
            break
        page_number += 1
    return activities


def fetch_dashboard(session):
    return _get(session, "/dashboard/query")


def fetch_analyse(session):
    return _get(session, "/analyse/query")


def fetch_schedule(session, start_date, end_date):
    return _get(session, "/training/schedule/query", {
        "startDate": start_date, "endDate": end_date, "supportRestExercise": 1,
    })


def fetch_schedule_summary(session, start_date, end_date):
    return _get(session, "/training/schedule/querysum", {
        "teamId": "", "userId": "", "startDate": start_date, "endDate": end_date,
    })


def fetch_dashboard_detail(session):
    return _get(session, "/dashboard/detail/query")


def fetch_cycle_record(session):
    return _get(session, "/dashboard/queryCycleRecord")


def fetch_import_sport_list(session):
    return _get(session, "/activity/fit/getImportSportList")


def scrape_all(token, user_id, schedule_start, schedule_end):
    session = _session(token, user_id)
    return {
        "activities": fetch_all_activities(session),
        "dashboard": fetch_dashboard(session),
        "dashboard_detail": fetch_dashboard_detail(session),
        "cycle_record": fetch_cycle_record(session),
        "analyse": fetch_analyse(session),
        "schedule": fetch_schedule(session, schedule_start, schedule_end),
        "schedule_summary": fetch_schedule_summary(session, schedule_start, schedule_end),
        "import_sport_list": fetch_import_sport_list(session),
    }
