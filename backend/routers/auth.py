import os
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr
from core import (db, hash_password, verify_password, create_access_token, create_refresh_token,
                  set_auth_cookies, ser, get_principal, Principal, JWT_ALGORITHM)

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_ATTEMPTS = 5
LOCK_MINUTES = 15


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


async def user_payload(user: dict) -> dict:
    out = ser(user)
    if user.get("tenant_id"):
        tenant = await db.tenants.find_one({"_id": user["tenant_id"]})
        out["tenant"] = ser(tenant)
    return out


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower().strip()
    ident = f"login:{email}"
    attempt = await db.login_attempts.find_one({"identifier": ident})
    if attempt and attempt.get("count", 0) >= MAX_ATTEMPTS:
        locked_until = datetime.fromisoformat(attempt["locked_until"])
        if datetime.now(timezone.utc) < locked_until:
            raise HTTPException(status_code=429, detail="Troppi tentativi. Riprova tra 15 minuti.")
        await db.login_attempts.delete_one({"identifier": ident})
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": ident},
            {"$inc": {"count": 1},
             "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)).isoformat()}},
            upsert=True)
        raise HTTPException(status_code=401, detail="Email o password non corretti")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account disattivato")
    await db.login_attempts.delete_one({"identifier": ident})
    access = create_access_token(user["_id"], user["email"])
    refresh = create_refresh_token(user["_id"])
    set_auth_cookies(response, access, refresh)
    out = await user_payload(user)
    out["access_token"] = access
    return out


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@router.get("/me")
async def me(p: Principal = Depends(get_principal)):
    user = await db.users.find_one({"_id": p.user_id})
    return await user_payload(user)


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Nessun refresh token")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Refresh token non valido")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token non valido")
    user = await db.users.find_one({"_id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="Utente non trovato")
    access = create_access_token(user["_id"], user["email"])
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    return {"access_token": access}


@router.post("/change-password")
async def change_password(body: ChangePasswordIn, p: Principal = Depends(get_principal)):
    user = await db.users.find_one({"_id": p.user_id})
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Password attuale errata")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="La nuova password deve avere almeno 8 caratteri")
    await db.users.update_one({"_id": p.user_id}, {"$set": {"password_hash": hash_password(body.new_password)}})
    return {"ok": True}
