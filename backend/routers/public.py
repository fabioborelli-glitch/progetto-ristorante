from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core import db, new_id, now_iso, ser

router = APIRouter(prefix="/public", tags=["public"])

PUBLIC_TENANT_FIELDS = ["id", "name", "slug", "city", "address", "phone", "description", "slots", "currency"]


async def get_tenant(slug: str) -> dict:
    tenant = await db.tenants.find_one({"slug": slug, "active": True})
    if not tenant:
        raise HTTPException(status_code=404, detail="Ristorante non trovato")
    return tenant


def public_tenant(t: dict) -> dict:
    d = ser(t)
    return {k: d.get(k) for k in PUBLIC_TENANT_FIELDS}


@router.get("/{slug}")
async def info(slug: str):
    return public_tenant(await get_tenant(slug))


@router.get("/{slug}/availability")
async def availability(slug: str, date: str, guests: int = 2):
    t = await get_tenant(slug)
    res = await db.reservations.find({"tenant_id": t["_id"], "date": date,
                                      "status": {"$nin": ["annullata", "no_show"]}}).to_list(1000)
    booked = {}
    for r in res:
        booked[r["time"]] = booked.get(r["time"], 0) + r["guests"]
    cap = t.get("capacity_per_slot", 40)
    return [{"time": s, "available": booked.get(s, 0) + guests <= cap} for s in t.get("slots", [])]


class PublicReservation(BaseModel):
    date: str
    time: str
    guests: int
    name: str
    phone: str
    email: Optional[str] = ""
    notes: Optional[str] = ""


@router.post("/{slug}/reservations", status_code=201)
async def book(slug: str, body: PublicReservation):
    t = await get_tenant(slug)
    if body.time not in t.get("slots", []):
        raise HTTPException(status_code=400, detail="Orario non disponibile")
    if body.guests < 1 or body.guests > 20:
        raise HTTPException(status_code=400, detail="Numero coperti non valido")
    res = await db.reservations.find({"tenant_id": t["_id"], "date": body.date, "time": body.time,
                                      "status": {"$nin": ["annullata", "no_show"]}}).to_list(1000)
    if sum(r["guests"] for r in res) + body.guests > t.get("capacity_per_slot", 40):
        raise HTTPException(status_code=400, detail="Posti esauriti per questo orario")
    doc = {"_id": new_id(), "tenant_id": t["_id"], **body.model_dump(), "table_id": None,
           "status": "in_attesa", "source": "online", "created_at": now_iso()}
    await db.reservations.insert_one(doc)
    return ser(doc)


@router.get("/{slug}/menu")
async def menu(slug: str, table: Optional[str] = None):
    t = await get_tenant(slug)
    cats = await db.categories.find({"tenant_id": t["_id"]}).sort("sort", 1).to_list(100)
    items = await db.menu_items.find({"tenant_id": t["_id"], "available": True}).sort("name", 1).to_list(500)
    table_doc = None
    if table:
        table_doc = await db.tables.find_one({"tenant_id": t["_id"], "code": table})
        if not table_doc:
            raise HTTPException(status_code=404, detail="Tavolo non trovato")
    return {"restaurant": public_tenant(t), "categories": [ser(c) for c in cats],
            "items": [ser(i) for i in items],
            "table": {"id": table_doc["_id"], "name": table_doc["name"], "code": table_doc["code"]} if table_doc else None}


class OrderLine(BaseModel):
    item_id: str
    qty: int
    variant: Optional[str] = None
    notes: Optional[str] = ""


class PublicOrder(BaseModel):
    table_code: str
    customer_name: Optional[str] = ""
    notes: Optional[str] = ""
    lines: List[OrderLine]


@router.post("/{slug}/orders", status_code=201)
async def place_order(slug: str, body: PublicOrder):
    t = await get_tenant(slug)
    table = await db.tables.find_one({"tenant_id": t["_id"], "code": body.table_code})
    if not table:
        raise HTTPException(status_code=404, detail="Tavolo non trovato")
    if not body.lines:
        raise HTTPException(status_code=400, detail="Carrello vuoto")
    ids = [l.item_id for l in body.lines]
    items = {i["_id"]: i for i in await db.menu_items.find({"tenant_id": t["_id"], "_id": {"$in": ids}, "available": True}).to_list(200)}
    lines, total = [], 0.0
    for l in body.lines:
        it = items.get(l.item_id)
        if not it or l.qty < 1:
            raise HTTPException(status_code=400, detail="Piatto non disponibile")
        price = it["price"]
        if l.variant:
            v = next((v for v in it.get("variants", []) if v["name"] == l.variant), None)
            if not v:
                raise HTTPException(status_code=400, detail="Variante non valida")
            price += v["price_delta"]
        lines.append({"item_id": it["_id"], "name": it["name"], "qty": l.qty, "variant": l.variant,
                      "notes": l.notes or "", "price": round(price, 2)})
        total += price * l.qty
    doc = {"_id": new_id(), "tenant_id": t["_id"], "table_id": table["_id"], "table_name": table["name"],
           "customer_name": body.customer_name or "", "notes": body.notes or "", "items": lines,
           "total": round(total, 2), "status": "nuovo", "source": "qr", "created_at": now_iso(), "updated_at": now_iso()}
    await db.orders.insert_one(doc)
    await db.tables.update_one({"_id": table["_id"]}, {"$set": {"status": "occupato"}})
    return ser(doc)


@router.get("/{slug}/orders/{order_id}")
async def order_status(slug: str, order_id: str):
    t = await get_tenant(slug)
    o = await db.orders.find_one({"tenant_id": t["_id"], "_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Ordine non trovato")
    return ser(o)
