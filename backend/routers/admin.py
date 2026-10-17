import re
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from core import db, new_id, now_iso, ser, hash_password, require_superadmin, Principal

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_superadmin)])

DEFAULT_SLOTS = ["12:00", "12:30", "13:00", "13:30", "14:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00"]


class TenantCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    city: Optional[str] = ""
    owner_name: str
    owner_email: EmailStr
    owner_password: str


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "ristorante"


def tenant_doc(name: str, slug: str, city: str = "") -> dict:
    return {"_id": new_id(), "name": name, "slug": slug, "city": city, "address": "", "phone": "",
            "description": "", "active": True, "slots": DEFAULT_SLOTS, "capacity_per_slot": 40,
            "currency": "EUR", "created_at": now_iso()}


@router.get("/tenants")
async def list_tenants():
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
async def create_tenant(body: TenantCreate):
    slug = slugify(body.slug or body.name)
    if await db.tenants.find_one({"slug": slug}):
        raise HTTPException(status_code=400, detail="Slug già in uso")
    email = body.owner_email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email owner già registrata")
    if len(body.owner_password) < 8:
        raise HTTPException(status_code=400, detail="Password owner: minimo 8 caratteri")
    tenant = tenant_doc(body.name, slug, body.city or "")
    await db.tenants.insert_one(tenant)
    room = {"_id": new_id(), "tenant_id": tenant["_id"], "name": "Sala principale", "sort": 0, "created_at": now_iso()}
    await db.rooms.insert_one(room)
    await db.users.insert_one({"_id": new_id(), "email": email, "name": body.owner_name,
                               "password_hash": hash_password(body.owner_password), "platform_role": None,
                               "tenant_id": tenant["_id"], "tenant_role": "owner", "active": True,
                               "created_at": now_iso()})
    return ser(tenant)


@router.patch("/tenants/{tenant_id}")
async def update_tenant(tenant_id: str, body: TenantUpdate):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    res = await db.tenants.find_one_and_update({"_id": tenant_id}, {"$set": upd}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Ristorante non trovato")
    return ser(res)


@router.get("/tenants/{tenant_id}/users")
async def tenant_users(tenant_id: str):
    users = await db.users.find({"tenant_id": tenant_id}).to_list(200)
    return [ser(u) for u in users]
