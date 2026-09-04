"""Client for the official COROS MCP server's read-only data tools.

Unlike coros_client.py (Playwright + the internal teameuapi.coros.com REST API,
returning clean JSON), the MCP tools are designed to feed an LLM's context and
return pre-formatted human-readable text blocks — see mcp_parsers.py for turning
that text back into typed data. queryActivityLapData is the one exception, already
returning structured JSON.

The server did not return an Mcp-Session-Id during testing, so no session state is
kept across calls within a scrape — each call redoes the lightweight initialize
handshake.
"""
import json

import requests

MCP_URL = "https://mcp.coros.com/mcp"
CLIENT_INFO = {"name": "coros-data-local", "version": "0.1"}

# key -> (tool name, arguments)
TOOLS = {
    "sleep": ("querySleepData", {"days": 14}),
    "daily_health": ("queryDailyHealthData", {"days": 14}),
    "training_load": ("queryTrainingLoadAssessment", {"days": 14}),
    "fitness_assessment": ("queryFitnessAssessmentOverview", {}),
    "devices": ("queryDevices", {}),
    "user_info": ("queryUserInfo", {}),
}


class McpCallError(Exception):
    pass


def _call(access_token, method, params=None, msg_id=1):
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    body = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if msg_id is not None:
        body["id"] = msg_id
    resp = requests.post(MCP_URL, headers=headers, json=body, timeout=30)
    resp.raise_for_status()

    if not resp.content:
        return None  # e.g. 202 Accepted for a fire-and-forget notification
    if "text/event-stream" in resp.headers.get("Content-Type", ""):
        lines = [l[len("data: "):] for l in resp.text.splitlines() if l.startswith("data: ")]
        parsed = [json.loads(l) for l in lines if l.strip()]
        return parsed[-1] if parsed else None
    return resp.json()


def _handshake(access_token):
    _call(access_token, "initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": CLIENT_INFO,
    }, msg_id=1)
    _call(access_token, "notifications/initialized", {}, msg_id=None)


def call_tool(access_token, name, arguments):
    """Calls one MCP tool and returns its decoded payload: a human-readable text
    block (most tools) or a dict (queryActivityLapData). The server double-encodes
    its content — content[0]["text"] is itself a JSON string (quoted, with literal
    \\n escapes) rather than plain text — so it needs one extra json.loads() to get
    real text back instead of a single line full of "\\n" characters."""
    response = _call(access_token, "tools/call", {"name": name, "arguments": arguments}, msg_id=2)
    if response is None:
        raise McpCallError(f"Pas de réponse pour l'outil {name}.")
    if "error" in response:
        raise McpCallError(f"Erreur MCP sur {name}: {response['error']}")

    result = response["result"]
    if result.get("isError"):
        raise McpCallError(f"L'outil {name} a renvoyé une erreur: {result}")
    return json.loads(result["content"][0]["text"])


def scrape_all(access_token):
    """Fetches the daily/snapshot data needed for the dashboard (sleep, health,
    training load, fitness assessment, devices, profile). Per-activity data
    (laps, FIT files) is fetched separately via get_lap_data / get_fit_download_urls
    since it needs a labelId/sportType per activity rather than a single call."""
    _handshake(access_token)
    return {
        key: call_tool(access_token, tool_name, args)
        for key, (tool_name, args) in TOOLS.items()
    }


def get_lap_data(access_token, label_id, sport_type):
    _handshake(access_token)
    return call_tool(access_token, "queryActivityLapData", {
        "labelId": label_id, "sportType": sport_type,
    })


def get_fit_download_urls(access_token, label_id, sport_type):
    _handshake(access_token)
    return call_tool(access_token, "queryActivityFitFileDownloadUrls", {
        "labelId": label_id, "sportType": sport_type,
    })
