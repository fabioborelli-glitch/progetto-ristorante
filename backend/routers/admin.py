import re
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, EmailStr
from core import db, new_id, now_iso, ser, hash_password, require_superadmin, Principal
from routers.invites import create_and_send_invite
from services.stations import DEFAULT_STATIONS

router = APIRouter(prefix="/admin", tags=["admin"])

DEFAULT_SLOTS = ["12:00", "12:30", "13:00", "13:30", "14:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00"]


class TenantCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    city: Optional[str] = ""
    owner_name: str
    owner_email: EmailStr
    owner_password: Optional[str] = None
    send_invite: bool = True


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "ristorante"


def tenant_doc(name: str, slug: str, city: str = "") -> dict:
    return {"_id": new_id(), "name": name, "slug": slug, "city": city, "address": "", "phone": "",
            "description": "", "logo_url": "", "active": True, "slots": DEFAULT_SLOTS, "capacity_per_slot": 40,
            "stations": [dict(s) for s in DEFAULT_STATIONS], "kds_warn_minutes": 15, "kds_alert_minutes": 25,
            "whatsapp_enabled": False,
            "currency": "EUR", "created_at": now_iso()}


@router.get("/tenants")
async def list_tenants(p: Principal = Depends(require_superadmin)):
    tenants = await db.tenants.find().sort("created_at", -1).to_list(500)
    out = []
    for t in tenants:
        d = ser(t)
        d["users_count"] = await db.users.count_documents({"tenant_id": t["_id"]})
        d["tables_count"] = await db.tables.count_documents({"tenant_id": t["_id"]})
        d["reservations_count"] = await db.reservations.count_documents({"tenant_id": t["_id"]})
        out.append(d)
    return out


@router.post("/tenants", status_code=201)
async def create_tenant(body: TenantCreate, request: Request, p: Principal = Depends(require_superadmin)):
    slug = slugify(body.slug or body.name)
    if await db.tenants.find_one({"slug": slug}):
        raise HTTPException(status_code=400, detail="Slug già in uso")
    email = body.owner_email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email owner già registrata")
    if not body.send_invite and (not body.owner_password or len(body.owner_password) < 8):
        raise HTTPException(status_code=400, detail="Password owner: minimo 8 caratteri")
    tenant = tenant_doc(body.name, slug, body.city or "")
    await db.tenants.insert_one(tenant)
    room = {"_id": new_id(), "tenant_id": tenant["_id"], "name": "Sala principale", "sort": 0, "created_at": now_iso()}
    await db.rooms.insert_one(room)
    out = ser(tenant)
    if body.send_invite:
        inv = await create_and_send_invite(request, tenant=tenant, email=email, name=body.owner_name, role="owner",
                                           inviter_name=p.name or "RistoOS", inviter_id=p.user_id)
        out["invite_sent_to"] = email
        out["invite_link"] = inv["link"]
    else:
        await db.users.insert_one({"_id": new_id(), "email": email, "name": body.owner_name,
                                   "password_hash": hash_password(body.owner_password), "platform_role": None,
                                   "tenant_id": tenant["_id"], "tenant_role": "owner", "active": True,
                                   "created_at": now_iso()})
    return out


@router.patch("/tenants/{tenant_id}")
async def update_tenant(tenant_id: str, body: TenantUpdate, p: Principal = Depends(require_superadmin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    res = await db.tenants.find_one_and_update({"_id": tenant_id}, {"$set": upd}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Ristorante non trovato")
    return ser(res)


@router.get("/tenants/{tenant_id}/users")
async def tenant_users(tenant_id: str, p: Principal = Depends(require_superadmin)):
    users = await db.users.find({"tenant_id": tenant_id}).to_list(200)
    return [ser(u) for u in users]
