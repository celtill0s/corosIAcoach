"""Turns the human-readable text blocks returned by the COROS MCP tools into typed
dicts for storage in db.py. These tools are designed to feed an LLM's context, not a
database, so the text format is as fragile to COROS wording changes as the Playwright
DOM selectors in coros_client.py — hence every parsed row keeps its raw_text alongside
the typed fields as a fallback.
"""
import re


def _hm_to_minutes(text):
    """'8h 13min' / '53 min' style durations to minutes."""
    if not text:
        return None
    m = re.match(r"(?:(\d+)h\s*)?(\d+)\s*min", text.strip())
    if not m:
        return None
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2))
    return hours * 60 + minutes


def _grab(pattern, block, cast=str, flags=0):
    m = re.search(pattern, block, flags)
    return cast(m.group(1)) if m else None


def parse_sleep(raw_text):
    rows = []
    for block in re.split(r"\n\s*\n", raw_text or ""):
        m_date = re.match(r"(\d{4})-(\d{2})-(\d{2})", block.strip())
        if not m_date:
            continue
        window = re.search(r"Main Sleep Window: (.+?) - (.+)", block)
        rows.append({
            "wake_day": int("".join(m_date.groups())),
            "sleep_score": _grab(r"Sleep Score: (\d+)", block, int),
            "main_sleep_minutes": _hm_to_minutes(_grab(r"Main Sleep: (.+)", block)),
            "deep_ratio": _grab(r"Deep Sleep Ratio: (\d+)%", block, lambda v: int(v) / 100),
            "light_ratio": _grab(r"Light Sleep Ratio: (\d+)%", block, lambda v: int(v) / 100),
            "rem_ratio": _grab(r"REM Ratio: (\d+)%", block, lambda v: int(v) / 100),
            "awake_ratio": _grab(r"Awake Ratio: (\d+)%", block, lambda v: int(v) / 100),
            "awake_minutes": _grab(r"Awake Time: (\d+) min", block, int),
            "awake_count": _grab(r"Awake Count \(>5 min\): (\d+)", block, int),
            "window_start": window.group(1) if window else None,
            "window_end": window.group(2) if window else None,
            "nap_minutes": _grab(r"Naps Total: (\d+) min", block, int),
            "raw_text": block.strip(),
        })
    return rows


def parse_daily_health(raw_text):
    raw_text = raw_text or ""
    header = raw_text.splitlines()[0] if raw_text else ""
    resting_hr = _grab(r"Resting HR: (\d+) bpm", header, int)
    hrv_baseline = _grab(r"HRV Baseline: (\d+) ms", header, int)

    day_blocks = []
    for block in re.split(r"\n\s*\n", raw_text):
        m_day = re.search(r"---\s*(\d{8})\s*---", block)
        if m_day:
            day_blocks.append((int(m_day.group(1)), block))

    latest_day = max((d for d, _ in day_blocks), default=None)

    rows = []
    for day, block in day_blocks:
        rows.append({
            "day": day,
            "steps": _grab(r"Steps: ([\d,]+)", block, lambda v: int(v.replace(",", ""))),
            "calories": _grab(r"Calories: ([\d,]+) kcal", block, lambda v: int(v.replace(",", ""))),
            "exercise_minutes": _hm_to_minutes(_grab(r"Exercise: (.+?) \|", block)),
            "floors": _grab(r"Floors: (\d+)", block, int),
            "stress_avg": _grab(r"Stress: Avg (\d+)", block, int),
            # Resting HR / HRV baseline are reported once, as of "now", not per day —
            # attached only to the most recent day rather than duplicated everywhere.
            "resting_hr": resting_hr if day == latest_day else None,
            "hrv_baseline": hrv_baseline if day == latest_day else None,
            "raw_text": block.strip(),
        })
    return rows


def parse_training_load(raw_text):
    rows = []
    for block in re.split(r"\n\s*\n", raw_text or ""):
        m_date = re.match(r"(\d{4})-(\d{2})-(\d{2})", block.strip())
        if not m_date:
            continue
        rows.append({
            "day": int("".join(m_date.groups())),
            "comment": _grab(r"Comment: (.+)", block),
            "short_term_load": _grab(r"Short-Term Load: (\d+)", block, int),
            "long_term_load": _grab(r"Long-Term Load: (\d+)", block, int),
            "load_ratio": _grab(r"Load Ratio: ([\d.]+)", block, float),
        })
    return rows


def parse_fitness_assessment(raw_text):
    raw_text = raw_text or ""
    return {
        "vo2max": _grab(r"VO2max: (\d+)", raw_text, int),
        "running_level": _grab(r"Running Level: (\d+)", raw_text, int),
        "threshold_pace": _grab(r"Threshold Pace: (.+)", raw_text),
        "pred_5k": _grab(r"5 km Prediction: (.+)", raw_text),
        "pred_10k": _grab(r"10 km Prediction: (.+)", raw_text),
        "pred_half": _grab(r"Half Marathon Prediction: (.+)", raw_text),
        # Anchored to line start: "Marathon Prediction:" is also a substring of
        # "Half Marathon Prediction:", which an unanchored search would match first.
        "pred_marathon": _grab(r"^Marathon Prediction: (.+)$", raw_text, flags=re.MULTILINE),
    }
