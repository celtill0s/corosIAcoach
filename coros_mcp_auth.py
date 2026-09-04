"""OAuth 2.1 + PKCE client for the official COROS MCP server (mcp.coros.com).

Discovery follows the MCP auth spec (RFC 9728 protected-resource metadata,
then OAuth authorization-server metadata) starting from the public resource
URL, so this works regardless of which regional server (EU, US...) the
account resolves to instead of hardcoding e.g. mcpeu.coros.com.

The client registers itself once via dynamic client registration (no COROS
developer account needed) and is a public client (PKCE, no secret).
"""
import base64
import hashlib
import json
import secrets
import time
from pathlib import Path
from urllib.parse import urlencode

import requests

BASE_DIR = Path(__file__).parent
CLIENT_FILE = BASE_DIR / "instance" / "mcp_client.json"
TOKENS_FILE = BASE_DIR / "instance" / "mcp_tokens.json"

MCP_RESOURCE_URL = "https://mcp.coros.com/mcp"
REDIRECT_URI = "http://127.0.0.1:5000/api/mcp/callback"
SCOPE = "openid mcp.tools offline_access"

# COROS's MCP server has been observed taking several seconds to answer even a
# trivial 401 (8s+ during testing) — generous timeout plus one retry so a
# transient slowdown doesn't surface as a hard login failure.
DISCOVERY_TIMEOUT = 30
DISCOVERY_RETRIES = 2


class McpAuthError(Exception):
    pass


def _get_with_retry(url, **kwargs):
    kwargs.setdefault("timeout", DISCOVERY_TIMEOUT)
    last_error = None
    for attempt in range(DISCOVERY_RETRIES):
        try:
            return requests.get(url, **kwargs)
        except requests.exceptions.Timeout as e:
            last_error = e
    raise McpAuthError(
        f"Le serveur COROS MCP ne répond pas ({url}), réessaie dans quelques instants."
    ) from last_error


def _discover():
    resp = _get_with_retry(MCP_RESOURCE_URL)
    if resp.status_code != 401:
        raise McpAuthError(f"Découverte MCP inattendue (statut {resp.status_code}).")

    www_auth = resp.headers.get("WWW-Authenticate", "")
    marker = 'resource_metadata="'
    start = www_auth.find(marker)
    if start == -1:
        raise McpAuthError("En-tête WWW-Authenticate sans resource_metadata.")
    start += len(marker)
    end = www_auth.find('"', start)
    resource_metadata_url = www_auth[start:end]

    resource_meta = _get_with_retry(resource_metadata_url)
    resource_meta.raise_for_status()
    auth_server = resource_meta.json()["authorization_servers"][0]

    as_meta = _get_with_retry(f"{auth_server}/.well-known/oauth-authorization-server")
    as_meta.raise_for_status()
    as_meta = as_meta.json()

    return {
        "authorize_endpoint": as_meta["authorization_endpoint"],
        "token_endpoint": as_meta["token_endpoint"],
        "registration_endpoint": as_meta["registration_endpoint"],
    }


def _get_or_register_client(discovery):
    if CLIENT_FILE.exists():
        return json.loads(CLIENT_FILE.read_text())

    resp = requests.post(discovery["registration_endpoint"], json={
        "client_name": "coros-data-local",
        "redirect_uris": [REDIRECT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": SCOPE,
    }, timeout=DISCOVERY_TIMEOUT)
    resp.raise_for_status()
    client = resp.json()
    CLIENT_FILE.parent.mkdir(exist_ok=True)
    CLIENT_FILE.write_text(json.dumps(client))
    return client


def _save_tokens(tokens):
    tokens = dict(tokens)
    tokens["obtained_at"] = int(time.time())
    TOKENS_FILE.parent.mkdir(exist_ok=True)
    TOKENS_FILE.write_text(json.dumps(tokens))


def _load_tokens():
    if not TOKENS_FILE.exists():
        return None
    return json.loads(TOKENS_FILE.read_text())


def start_authorization():
    """Returns (auth_url, pkce_state). Caller must keep pkce_state (e.g. in the
    Flask session) until the callback arrives, then pass it to complete_authorization()."""
    discovery = _discover()
    client = _get_or_register_client(discovery)

    verifier = base64.urlsafe_b64encode(secrets.token_bytes(40)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)

    auth_url = discovery["authorize_endpoint"] + "?" + urlencode({
        "response_type": "code",
        "client_id": client["client_id"],
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    })

    pkce_state = {
        "verifier": verifier,
        "state": state,
        "client_id": client["client_id"],
        "token_endpoint": discovery["token_endpoint"],
    }
    return auth_url, pkce_state


def complete_authorization(pkce_state, code, returned_state):
    if not code or returned_state != pkce_state.get("state"):
        raise McpAuthError("Code manquant ou state OAuth invalide.")

    resp = requests.post(pkce_state["token_endpoint"], data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": pkce_state["client_id"],
        "code_verifier": pkce_state["verifier"],
    }, timeout=DISCOVERY_TIMEOUT)
    resp.raise_for_status()
    tokens = resp.json()
    _save_tokens(tokens)
    return tokens


def _refresh(tokens, client_id, token_endpoint):
    resp = requests.post(token_endpoint, data={
        "grant_type": "refresh_token",
        "refresh_token": tokens["refresh_token"],
        "client_id": client_id,
    }, timeout=DISCOVERY_TIMEOUT)
    resp.raise_for_status()
    new_tokens = resp.json()
    new_tokens.setdefault("refresh_token", tokens["refresh_token"])
    _save_tokens(new_tokens)
    return new_tokens


def get_valid_access_token():
    """Returns a valid access token, refreshing it if needed. Returns None if the
    user has never connected via MCP (caller should fall back to another data source)."""
    tokens = _load_tokens()
    if tokens is None:
        return None

    expires_at = tokens["obtained_at"] + tokens.get("expires_in", 0)
    if time.time() < expires_at - 60:
        return tokens["access_token"]

    if "refresh_token" not in tokens or not CLIENT_FILE.exists():
        return None

    client = json.loads(CLIENT_FILE.read_text())
    discovery = _discover()
    tokens = _refresh(tokens, client["client_id"], discovery["token_endpoint"])
    return tokens["access_token"]


def is_connected():
    return TOKENS_FILE.exists()
