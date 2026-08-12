import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "coros_data.sqlite"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS activities (
            label_id TEXT PRIMARY KEY,
            date INTEGER,
            name TEXT,
            sport_type INTEGER,
            mode INTEGER,
            distance REAL,
            total_time INTEGER,
            avg_hr INTEGER,
            avg_speed REAL,
            avg_cadence INTEGER,
            avg_power INTEGER,
            ascent INTEGER,
            descent INTEGER,
            calorie INTEGER,
            training_load INTEGER,
            device TEXT,
            start_time INTEGER,
            end_time INTEGER,
            raw_json TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_analysis (
            happen_day INTEGER PRIMARY KEY,
            training_load INTEGER,
            tired_rate REAL,
            stamina_level REAL,
            rhr INTEGER,
            test_rhr INTEGER,
            vo2max INTEGER,
            performance INTEGER,
            distance REAL,
            duration INTEGER,
            training_load_ratio REAL,
            raw_json TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS raw_snapshots (
            name TEXT PRIMARY KEY,
            raw_json TEXT
        )
    """)
    conn.commit()
    conn.close()


RAW_SNAPSHOT_KEYS = [
    "dashboard", "dashboard_detail", "cycle_record", "analyse", "schedule",
    "schedule_summary", "profile_private", "profile_public", "import_sport_list",
]


def save_scrape(result):
    conn = get_conn()

    activities = result["activities"]
    rows = [(
        # workoutTime (moving time), not totalTime (elapsed time incl. pauses) — this is
        # what COROS's own UI displays as "Temps d'activité"; totalTime can be wildly
        # larger when a watch keeps recording during a long pause.
        a.get("labelId"), a.get("date"), a.get("name"), a.get("sportType"), a.get("mode"),
        a.get("distance"), a.get("workoutTime") or a.get("totalTime"), a.get("avgHr"), a.get("avgSpeed"),
        a.get("avgCadence"), a.get("avgPower"), a.get("ascent"), a.get("descent"),
        a.get("calorie"), a.get("trainingLoad"), a.get("device"), a.get("startTime"),
        a.get("endTime"), json.dumps(a, ensure_ascii=False),
    ) for a in activities]
    conn.executemany("""
        INSERT INTO activities VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(label_id) DO UPDATE SET raw_json=excluded.raw_json
    """, rows)

    day_list = result["analyse"].get("data", {}).get("dayList", [])
    rows = [(
        d.get("happenDay"), d.get("trainingLoad"), d.get("tiredRateNew"), d.get("staminaLevel"),
        d.get("rhr"), d.get("testRhr"), d.get("vo2max"), d.get("performance"), d.get("distance"),
        d.get("duration"), d.get("trainingLoadRatio"),
        json.dumps(d, ensure_ascii=False),
    ) for d in day_list]
    conn.executemany("""
        INSERT INTO daily_analysis VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(happen_day) DO UPDATE SET raw_json=excluded.raw_json
    """, rows)

    for key in RAW_SNAPSHOT_KEYS:
        if key in result:
            conn.execute(
                "INSERT OR REPLACE INTO raw_snapshots VALUES (?, ?)",
                (key, json.dumps(result[key], ensure_ascii=False)),
            )

    conn.commit()
    conn.close()


def get_raw_snapshot(name):
    conn = get_conn()
    row = conn.execute("SELECT raw_json FROM raw_snapshots WHERE name=?", (name,)).fetchone()
    conn.close()
    if not row:
        return None
    return json.loads(row["raw_json"])


def get_dashboard_data():
    conn = get_conn()

    activities = [dict(r) for r in conn.execute(
        "SELECT date, name, sport_type, distance, total_time, avg_hr, ascent, "
        "calorie, training_load, device FROM activities ORDER BY date DESC"
    )]

    daily = [dict(r) for r in conn.execute(
        "SELECT happen_day, training_load, tired_rate, stamina_level, rhr, test_rhr, vo2max, "
        "performance, distance, duration, training_load_ratio FROM daily_analysis ORDER BY happen_day ASC"
    )]

    snapshot_row = conn.execute(
        "SELECT raw_json FROM raw_snapshots WHERE name='dashboard'"
    ).fetchone()
    dashboard = json.loads(snapshot_row["raw_json"])["data"] if snapshot_row else {}

    conn.close()
    return {"activities": activities, "daily": daily, "dashboard": dashboard}


def get_analyse_data():
    analyse = get_raw_snapshot("analyse")
    return analyse["data"] if analyse else {}


def has_data():
    if not DB_PATH.exists():
        return False
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) AS c FROM activities").fetchone()["c"]
    conn.close()
    return count > 0
