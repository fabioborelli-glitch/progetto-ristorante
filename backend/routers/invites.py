import os
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from pydantic import BaseModel, EmailStr
from core import (db, new_id, now_iso, ser, tq, require_tenant, Principal, hash_password, TENANT_ROLES, ROLE_RANK,
                  create_access_token, create_refresh_token, set_auth_cookies)
from services.email import send_invite_email

router = APIRouter(tags=["invites"])


def invite_link(request: Request, token: str) -> str:
    origin = request.headers.get("Origin") or os.environ.get("APP_URL", "")
    return f"{origin.rstrip('/')}/invito/{token}"


async def create_and_send_invite(request: Request, *, tenant: dict, email: str, name: str, role: str,
                                 inviter_name: str, inviter_id: Optional[str]) -> dict:
    email = email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email già registrata")
    await db.invites.delete_many({"email": email, "tenant_id": tenant["_id"], "accepted_at": None})
    token = secrets.token_urlsafe(32)
    doc = {"_id": new_id(), "tenant_id": tenant["_id"], "email": email, "name": name, "tenant_role": role,
           "token": token, "invited_by": inviter_id, "inviter_name": inviter_name,
           "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
           "accepted_at": None, "created_at": now_iso()}
    await db.invites.insert_one(doc)
    link = invite_link(request, token)
    await send_invite_email(to=email, invitee_name=name, tenant_name=tenant["name"], role=role,
                            inviter_name=inviter_name, link=link)
    out = ser(doc)
    out["link"] = link
    return out


class InviteIn(BaseModel):
    name: str
    email: EmailStr
    tenant_role: str = "staff"


@router.get("/t/invites")
async def list_invites(p: Principal = Depends(require_tenant("manager"))):
    now = now_iso()
    docs = await db.invites.find(tq(p, {"accepted_at": None, "expires_at": {"$gt": now}})).sort("created_at", -1).to_list(100)
    return [{**ser(d), "token": None} for d in docs]


@router.post("/t/invites", status_code=201)
async def invite(body: InviteIn, request: Request, p: Principal = Depends(require_tenant("manager"))):
    if body.tenant_role not in TENANT_ROLES:
        raise HTTPException(status_code=400, detail="Ruolo non valido")
    if ROLE_RANK[body.tenant_role] > ROLE_RANK[p.tenant_role]:
        raise HTTPException(status_code=403, detail="Non puoi assegnare un ruolo superiore al tuo")
    tenant = await db.tenants.find_one({"_id": p.tenant_id})
    return await create_and_send_invite(request, tenant=tenant, email=body.email, name=body.name,
                                        role=body.tenant_role, inviter_name=p.name or p.email, inviter_id=p.user_id)


@router.delete("/t/invites/{invite_id}")
async def revoke_invite(invite_id: str, p: Principal = Depends(require_tenant("manager"))):
    res = await db.invites.delete_one(tq(p, {"_id": invite_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invito non trovato")
    return {"ok": True}


async def valid_invite(token: str) -> dict:
    inv = await db.invites.find_one({"token": token, "accepted_at": None})
    if not inv or inv["expires_at"] < now_iso():
        raise HTTPException(status_code=404, detail="Invito non valido o scaduto")
    return inv


@router.get("/invites/{token}")
async def invite_info(token: str):
    inv = await valid_invite(token)
    tenant = await db.tenants.find_one({"_id": inv["tenant_id"]})
    return {"email": inv["email"], "name": inv["name"], "tenant_role": inv["tenant_role"],
            "tenant_name": tenant["name"] if tenant else "", "inviter_name": inv.get("inviter_name", "")}


class AcceptIn(BaseModel):
    name: str
    password: str


@router.post("/invites/{token}/accept")
async def accept_invite(token: str, body: AcceptIn, response: Response):
    inv = await valid_invite(token)
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password: minimo 8 caratteri")
    if await db.users.find_one({"email": inv["email"]}):
        raise HTTPException(status_code=400, detail="Email già registrata")
    user = {"_id": new_id(), "email": inv["email"], "name": body.name.strip() or inv["name"],
            "password_hash": hash_password(body.password), "platform_role": None, "tenant_id": inv["tenant_id"],
            "tenant_role": inv["tenant_role"], "active": True, "created_at": now_iso()}
    await db.users.insert_one(user)
    await db.invites.update_one({"_id": inv["_id"]}, {"$set": {"accepted_at": now_iso()}})
    access = create_access_token(user["_id"], user["email"])
    set_auth_cookies(response, access, create_refresh_token(user["_id"]))
    out = ser(user)
    out["tenant"] = ser(await db.tenants.find_one({"_id": inv["tenant_id"]}))
    out["access_token"] = access
    return out
