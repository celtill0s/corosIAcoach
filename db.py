import json
import sqlite3
from pathlib import Path

import mcp_parsers

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
    # Sourced from the COROS MCP server (coros_mcp_client.py) — fills gaps the
    # Playwright/internal-API scraper can't reach (sleep, stress, HRV baseline).
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sleep (
            wake_day INTEGER PRIMARY KEY,
            sleep_score INTEGER,
            main_sleep_minutes INTEGER,
            deep_ratio REAL,
            light_ratio REAL,
            rem_ratio REAL,
            awake_ratio REAL,
            awake_minutes INTEGER,
            awake_count INTEGER,
            window_start TEXT,
            window_end TEXT,
            nap_minutes INTEGER,
            raw_text TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_health (
            day INTEGER PRIMARY KEY,
            steps INTEGER,
            calories INTEGER,
            exercise_minutes INTEGER,
            floors INTEGER,
            stress_avg INTEGER,
            resting_hr INTEGER,
            hrv_baseline INTEGER,
            raw_text TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS training_load_daily (
            day INTEGER PRIMARY KEY,
            comment TEXT,
            short_term_load INTEGER,
            long_term_load INTEGER,
            load_ratio REAL
        )
    """)
    conn.commit()
    conn.close()


RAW_SNAPSHOT_KEYS = [
    "dashboard", "dashboard_detail", "cycle_record", "analyse", "schedule",
    "schedule_summary", "import_sport_list",
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


def save_mcp_scrape(result):
    conn = get_conn()

    sleep_rows = mcp_parsers.parse_sleep(result.get("sleep"))
    rows = [(
        r["wake_day"], r["sleep_score"], r["main_sleep_minutes"], r["deep_ratio"],
        r["light_ratio"], r["rem_ratio"], r["awake_ratio"], r["awake_minutes"],
        r["awake_count"], r["window_start"], r["window_end"], r["nap_minutes"], r["raw_text"],
    ) for r in sleep_rows]
    conn.executemany("""
        INSERT INTO sleep VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(wake_day) DO UPDATE SET
            sleep_score=excluded.sleep_score, main_sleep_minutes=excluded.main_sleep_minutes,
            deep_ratio=excluded.deep_ratio, light_ratio=excluded.light_ratio, rem_ratio=excluded.rem_ratio,
            awake_ratio=excluded.awake_ratio, awake_minutes=excluded.awake_minutes,
            awake_count=excluded.awake_count, window_start=excluded.window_start,
            window_end=excluded.window_end, nap_minutes=excluded.nap_minutes, raw_text=excluded.raw_text
    """, rows)

    health_rows = mcp_parsers.parse_daily_health(result.get("daily_health"))
    rows = [(
        r["day"], r["steps"], r["calories"], r["exercise_minutes"], r["floors"],
        r["stress_avg"], r["resting_hr"], r["hrv_baseline"], r["raw_text"],
    ) for r in health_rows]
    conn.executemany("""
        INSERT INTO daily_health VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET
            steps=excluded.steps, calories=excluded.calories, exercise_minutes=excluded.exercise_minutes,
            floors=excluded.floors, stress_avg=excluded.stress_avg,
            resting_hr=excluded.resting_hr, hrv_baseline=excluded.hrv_baseline,
            raw_text=excluded.raw_text
    """, rows)

    load_rows = mcp_parsers.parse_training_load(result.get("training_load"))
    rows = [(
        r["day"], r["comment"], r["short_term_load"], r["long_term_load"], r["load_ratio"],
    ) for r in load_rows]
    conn.executemany("""
        INSERT INTO training_load_daily VALUES (?,?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET
            comment=excluded.comment, short_term_load=excluded.short_term_load,
            long_term_load=excluded.long_term_load, load_ratio=excluded.load_ratio
    """, rows)

    if result.get("fitness_assessment"):
        fitness = mcp_parsers.parse_fitness_assessment(result["fitness_assessment"])
        conn.execute(
            "INSERT OR REPLACE INTO raw_snapshots VALUES (?, ?)",
            ("mcp_fitness_assessment", json.dumps(fitness, ensure_ascii=False)),
        )

    for key in ("devices", "user_info"):
        if result.get(key):
            conn.execute(
                "INSERT OR REPLACE INTO raw_snapshots VALUES (?, ?)",
                (f"mcp_{key}", json.dumps({"raw_text": result[key]}, ensure_ascii=False)),
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

    sleep = [dict(r) for r in conn.execute(
        "SELECT wake_day, sleep_score, main_sleep_minutes, deep_ratio, light_ratio, "
        "rem_ratio, window_start, window_end FROM sleep ORDER BY wake_day ASC"
    )]

    daily_health = [dict(r) for r in conn.execute(
        "SELECT day, steps, calories, exercise_minutes, stress_avg, resting_hr, "
        "hrv_baseline FROM daily_health ORDER BY day ASC"
    )]

    training_load_daily = [dict(r) for r in conn.execute(
        "SELECT day, comment, short_term_load, long_term_load, load_ratio "
        "FROM training_load_daily ORDER BY day ASC"
    )]

    fitness_assessment = get_raw_snapshot("mcp_fitness_assessment")

    conn.close()
    return {
        "activities": activities, "daily": daily, "dashboard": dashboard,
        "sleep": sleep, "daily_health": daily_health,
        "training_load_daily": training_load_daily,
        "fitness_assessment": fitness_assessment,
    }


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
