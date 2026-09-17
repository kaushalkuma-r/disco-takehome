"""Supabase JWT verification via the project's JWKS (ES256), with a cached key set.

`get_current_user` is the FastAPI dependency; it also upserts the profile on first sight and
grants the signup credits exactly once.
"""
from __future__ import annotations

import logging
import time
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from . import db
from .agent.registry import UserCtx
from .billing import credits
from .config import get_settings

log = logging.getLogger(__name__)
_bearer = HTTPBearer(auto_error=False)
_seen: dict[UUID, float] = {}     # user_id → monotonic time of last profile upsert (skip the DB round trip for 10 min)
SEEN_TTL = 600.0


@lru_cache
def jwks_client() -> PyJWKClient:
    return PyJWKClient(f"{get_settings().supabase_url}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def verify_token(token: str) -> dict:
    """Return claims or raise 401. Supports ES256 (JWKS) and legacy HS256 if a secret is configured."""
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg", "").startswith("HS"):
            raise HTTPException(401, "unsupported token algorithm")
        key = jwks_client().get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=[header["alg"]], audience="authenticated")
    except HTTPException:
        raise
    except Exception as e:  # expired, bad signature, malformed
        raise HTTPException(401, f"invalid token: {type(e).__name__}") from e


async def get_current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> UserCtx:
    if creds is None:
        raise HTTPException(401, "missing bearer token")
    claims = verify_token(creds.credentials)
    user_id = UUID(claims["sub"])
    email = claims.get("email") or ""
    name = (claims.get("user_metadata") or {}).get("full_name") or (claims.get("user_metadata") or {}).get("name") or email.split("@")[0]
    now = time.monotonic()
    if now - _seen.get(user_id, -1e9) > SEEN_TTL:
        async with db.tx() as conn:
            inserted = await conn.fetchval(
                "insert into profiles (id, email, display_name) values ($1, $2, $3) on conflict (id) do update set email = excluded.email returning (xmax = 0)",
                user_id, email, name)
            if inserted:
                await credits.grant_signup(conn, user_id)
                log.info("new profile %s granted signup credits", user_id)
        _seen[user_id] = now
        if len(_seen) > 5000:
            _seen.clear()
    return UserCtx(id=user_id, email=email, name=name)
