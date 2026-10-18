import random
import string
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from core import db, new_id, now_iso, ser, tq, get_scoped_or_404, require_tenant, Principal
from services.ws import hub

router = APIRouter(tags=["waitlist"])

WL_STATUSES = ["in_attesa", "chiamato", "seduto", "annullato", "no_show"]
ACTIVE = ["in_attesa", "chiamato"]


def wl_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=5))


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class WaitIn(BaseModel):
    name: str
    guests: int = 2
    phone: Optional[str] = ""
    notes: Optional[str] = ""
    quoted_minutes: Optional[int] = None


class WaitPatch(BaseModel):
    status: Optional[str] = None
    table_id: Optional[str] = None
    notes: Optional[str] = None
    guests: Optional[int] = None
    quoted_minutes: Optional[int] = None


def with_position(entries: list) -> list:
    pos = 0
    out = []
    for e in entries:
        d = ser(e)
        if d["status"] == "in_attesa":
            pos += 1
            d["position"] = pos
        else:
            d["position"] = None
        out.append(d)
    return out


@router.get("/t/waitlist")
async def list_waitlist(all: bool = False, p: Principal = Depends(require_tenant())):
    q = tq(p, {"date": today()} if not all else None)
    entries = await db.waitlist.find(q).sort("created_at", 1).to_list(500)
    return with_position(entries)


@router.post("/t/waitlist", status_code=201)
async def add_waitlist(body: WaitIn, p: Principal = Depends(require_tenant())):
    if body.guests < 1:
        raise HTTPException(status_code=400, detail="Numero persone non valido")
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, "code": wl_code(), "date": today(), **body.model_dump(),
           "status": "in_attesa", "table_id": None, "created_at": now_iso(), "called_at": None, "seated_at": None}
    await db.waitlist.insert_one(doc)
    await hub.emit(p.tenant_id, "waitlist_changed")
    entries = await db.waitlist.find(tq(p, {"date": today()})).sort("created_at", 1).to_list(500)
    return next(e for e in with_position(entries) if e["id"] == doc["_id"])


@router.patch("/t/waitlist/{entry_id}")
async def patch_waitlist(entry_id: str, body: WaitPatch, p: Principal = Depends(require_tenant())):
    entry = await get_scoped_or_404(p, "waitlist", entry_id)
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in upd:
        if upd["status"] not in WL_STATUSES:
            raise HTTPException(status_code=400, detail="Stato non valido")
        if upd["status"] == "chiamato":
            upd["called_at"] = now_iso()
        if upd["status"] == "seduto":
            upd["seated_at"] = now_iso()
            tid = upd.get("table_id") or entry.get("table_id")
            if tid:
                await get_scoped_or_404(p, "tables", tid)
                await db.tables.update_one(tq(p, {"_id": tid}), {"$set": {"status": "occupato"}})
                await hub.emit(p.tenant_id, "tables_changed")
    await db.waitlist.update_one({"_id": entry_id}, {"$set": upd})
    await hub.emit(p.tenant_id, "waitlist_changed")
    entries = await db.waitlist.find(tq(p, {"date": entry["date"]})).sort("created_at", 1).to_list(500)
    return next(e for e in with_position(entries) if e["id"] == entry_id)


@router.delete("/t/waitlist/{entry_id}")
async def delete_waitlist(entry_id: str, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "waitlist", entry_id)
    await db.waitlist.delete_one({"_id": entry_id})
    await hub.emit(p.tenant_id, "waitlist_changed")
    return {"ok": True}


@router.get("/public/{slug}/waitlist/{code}")
async def public_waitlist(slug: str, code: str):
    tenant = await db.tenants.find_one({"slug": slug, "active": True})
    if not tenant:
        raise HTTPException(status_code=404, detail="Ristorante non trovato")
    entry = await db.waitlist.find_one({"tenant_id": tenant["_id"], "code": code.upper()})
    if not entry:
        raise HTTPException(status_code=404, detail="Codice non trovato")
    ahead = 0
    if entry["status"] == "in_attesa":
        ahead = await db.waitlist.count_documents({"tenant_id": tenant["_id"], "date": entry["date"], "status": "in_attesa",
                                                   "created_at": {"$lt": entry["created_at"]}})
    return {"restaurant": {"name": tenant["name"], "phone": tenant.get("phone"), "logo_url": tenant.get("logo_url")},
            "name": entry["name"], "guests": entry["guests"], "status": entry["status"], "ahead": ahead,
            "quoted_minutes": entry.get("quoted_minutes"), "created_at": entry["created_at"], "called_at": entry.get("called_at")}
