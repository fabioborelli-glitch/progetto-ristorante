import random
import string
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from core import (db, new_id, now_iso, ser, tq, get_scoped_or_404, require_tenant, Principal,
                  hash_password, TENANT_ROLES, ROLE_RANK)

router = APIRouter(prefix="/t", tags=["tenant"])

TABLE_STATUSES = ["libero", "occupato", "in_attesa_conto"]
RES_STATUSES = ["in_attesa", "confermata", "seduta", "completata", "annullata", "no_show"]
ORDER_STATUSES = ["nuovo", "in_preparazione", "pronto", "servito", "annullato"]
ALLERGENS = ["glutine", "crostacei", "uova", "pesce", "arachidi", "soia", "latte", "frutta_a_guscio",
             "sedano", "senape", "sesamo", "solfiti", "lupini", "molluschi"]


def table_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


# ---------- Settings ----------
class TenantSettings(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None
    slots: Optional[List[str]] = None
    capacity_per_slot: Optional[int] = None


@router.get("/settings")
async def get_settings(p: Principal = Depends(require_tenant("staff"))):
    return ser(await db.tenants.find_one({"_id": p.tenant_id}))


@router.patch("/settings")
async def update_settings(body: TenantSettings, p: Principal = Depends(require_tenant("manager"))):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    res = await db.tenants.find_one_and_update({"_id": p.tenant_id}, {"$set": upd}, return_document=True)
    return ser(res)


# ---------- Team ----------
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    tenant_role: str = "staff"


@router.get("/users")
async def list_users(p: Principal = Depends(require_tenant("manager"))):
    return [ser(u) for u in await db.users.find(tq(p)).to_list(200)]


@router.post("/users", status_code=201)
async def create_user(body: UserCreate, p: Principal = Depends(require_tenant("manager"))):
    if body.tenant_role not in TENANT_ROLES:
        raise HTTPException(status_code=400, detail="Ruolo non valido")
    if ROLE_RANK[body.tenant_role] > ROLE_RANK[p.tenant_role]:
        raise HTTPException(status_code=403, detail="Non puoi assegnare un ruolo superiore al tuo")
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email già registrata")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password: minimo 8 caratteri")
    doc = {"_id": new_id(), "email": email, "name": body.name, "password_hash": hash_password(body.password),
           "platform_role": None, "tenant_id": p.tenant_id, "tenant_role": body.tenant_role, "active": True,
           "created_at": now_iso()}
    await db.users.insert_one(doc)
    return ser(doc)


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, p: Principal = Depends(require_tenant("owner"))):
    if user_id == p.user_id:
        raise HTTPException(status_code=400, detail="Non puoi eliminare te stesso")
    res = await db.users.delete_one(tq(p, {"_id": user_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    return {"ok": True}


# ---------- Rooms ----------
class RoomIn(BaseModel):
    name: str


@router.get("/rooms")
async def list_rooms(p: Principal = Depends(require_tenant())):
    return [ser(r) for r in await db.rooms.find(tq(p)).sort("sort", 1).to_list(50)]


@router.post("/rooms", status_code=201)
async def create_room(body: RoomIn, p: Principal = Depends(require_tenant("manager"))):
    count = await db.rooms.count_documents(tq(p))
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, "name": body.name, "sort": count, "created_at": now_iso()}
    await db.rooms.insert_one(doc)
    return ser(doc)


@router.patch("/rooms/{room_id}")
async def update_room(room_id: str, body: RoomIn, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "rooms", room_id)
    res = await db.rooms.find_one_and_update(tq(p, {"_id": room_id}), {"$set": {"name": body.name}}, return_document=True)
    return ser(res)


@router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "rooms", room_id)
    if await db.tables.count_documents(tq(p, {"room_id": room_id})) > 0:
        raise HTTPException(status_code=400, detail="Elimina prima i tavoli della sala")
    await db.rooms.delete_one(tq(p, {"_id": room_id}))
    return {"ok": True}


# ---------- Tables ----------
class TableCreate(BaseModel):
    room_id: str
    name: str
    seats: int = 4
    shape: str = "square"
    x: float = 40
    y: float = 40


class TableUpdate(BaseModel):
    name: Optional[str] = None
    seats: Optional[int] = None
    shape: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    status: Optional[str] = None
    room_id: Optional[str] = None


class TablePosition(BaseModel):
    id: str
    x: float
    y: float


@router.get("/tables")
async def list_tables(room_id: Optional[str] = None, p: Principal = Depends(require_tenant())):
    q = tq(p, {"room_id": room_id} if room_id else None)
    tables = [ser(t) for t in await db.tables.find(q).sort("name", 1).to_list(300)]
    open_orders = await db.orders.find(tq(p, {"status": {"$in": ["nuovo", "in_preparazione", "pronto"]}})).to_list(500)
    counts = {}
    for o in open_orders:
        counts[o["table_id"]] = counts.get(o["table_id"], 0) + 1
    for t in tables:
        t["open_orders"] = counts.get(t["id"], 0)
    return tables


@router.post("/tables", status_code=201)
async def create_table(body: TableCreate, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "rooms", body.room_id)
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, "code": table_code(), "status": "libero",
           **body.model_dump(), "created_at": now_iso()}
    await db.tables.insert_one(doc)
    return ser(doc)


@router.patch("/tables/{table_id}")
async def update_table(table_id: str, body: TableUpdate, p: Principal = Depends(require_tenant())):
    await get_scoped_or_404(p, "tables", table_id)
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if any(k in upd for k in ("x", "y", "name", "seats", "shape", "room_id")) and ROLE_RANK[p.tenant_role] < ROLE_RANK["manager"]:
        raise HTTPException(status_code=403, detail="Solo manager e owner possono modificare i tavoli")
    if "status" in upd and upd["status"] not in TABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Stato non valido")
    if upd.get("status") == "libero":
        await db.orders.update_many(tq(p, {"table_id": table_id, "status": {"$in": ["nuovo", "in_preparazione", "pronto"]}}),
                                    {"$set": {"status": "servito", "updated_at": now_iso()}})
    res = await db.tables.find_one_and_update(tq(p, {"_id": table_id}), {"$set": upd}, return_document=True)
    return ser(res)


@router.put("/tables/positions")
async def update_positions(body: List[TablePosition], p: Principal = Depends(require_tenant("manager"))):
    for t in body:
        await db.tables.update_one(tq(p, {"_id": t.id}), {"$set": {"x": t.x, "y": t.y}})
    return {"ok": True}


@router.delete("/tables/{table_id}")
async def delete_table(table_id: str, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "tables", table_id)
    await db.tables.delete_one(tq(p, {"_id": table_id}))
    return {"ok": True}


# ---------- Reservations ----------
class ReservationIn(BaseModel):
    date: str
    time: str
    guests: int
    name: str
    phone: Optional[str] = ""
    email: Optional[str] = ""
    notes: Optional[str] = ""
    table_id: Optional[str] = None
    status: str = "confermata"


class ReservationUpdate(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    guests: Optional[int] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    table_id: Optional[str] = None
    status: Optional[str] = None


@router.get("/reservations")
async def list_reservations(date: Optional[str] = None, p: Principal = Depends(require_tenant())):
    q = tq(p, {"date": date} if date else None)
    res = await db.reservations.find(q).sort([("date", 1), ("time", 1)]).to_list(1000)
    return [ser(r) for r in res]


@router.post("/reservations", status_code=201)
async def create_reservation(body: ReservationIn, p: Principal = Depends(require_tenant())):
    if body.status not in RES_STATUSES:
        raise HTTPException(status_code=400, detail="Stato non valido")
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, **body.model_dump(), "source": "manuale",
           "created_at": now_iso()}
    await db.reservations.insert_one(doc)
    return ser(doc)


@router.patch("/reservations/{res_id}")
async def update_reservation(res_id: str, body: ReservationUpdate, p: Principal = Depends(require_tenant())):
    current = await get_scoped_or_404(p, "reservations", res_id)
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in upd and upd["status"] not in RES_STATUSES:
        raise HTTPException(status_code=400, detail="Stato non valido")
    if upd.get("status") == "seduta":
        tid = upd.get("table_id") or current.get("table_id")
        if tid:
            await db.tables.update_one(tq(p, {"_id": tid}), {"$set": {"status": "occupato"}})
    res = await db.reservations.find_one_and_update(tq(p, {"_id": res_id}), {"$set": upd}, return_document=True)
    return ser(res)


@router.delete("/reservations/{res_id}")
async def delete_reservation(res_id: str, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "reservations", res_id)
    await db.reservations.delete_one(tq(p, {"_id": res_id}))
    return {"ok": True}


# ---------- Menu ----------
class CategoryIn(BaseModel):
    name: str
    name_en: Optional[str] = ""


class VariantIn(BaseModel):
    name: str
    price_delta: float = 0


class MenuItemIn(BaseModel):
    category_id: str
    name: str
    name_en: Optional[str] = ""
    description: Optional[str] = ""
    price: float
    allergens: List[str] = []
    variants: List[VariantIn] = []
    available: bool = True
    image_url: Optional[str] = ""


class MenuItemUpdate(BaseModel):
    category_id: Optional[str] = None
    name: Optional[str] = None
    name_en: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    allergens: Optional[List[str]] = None
    variants: Optional[List[VariantIn]] = None
    available: Optional[bool] = None
    image_url: Optional[str] = None


@router.get("/menu/allergens")
async def list_allergens():
    return ALLERGENS


@router.get("/menu/categories")
async def list_categories(p: Principal = Depends(require_tenant())):
    return [ser(c) for c in await db.categories.find(tq(p)).sort("sort", 1).to_list(100)]


@router.post("/menu/categories", status_code=201)
async def create_category(body: CategoryIn, p: Principal = Depends(require_tenant("manager"))):
    count = await db.categories.count_documents(tq(p))
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, **body.model_dump(), "sort": count, "created_at": now_iso()}
    await db.categories.insert_one(doc)
    return ser(doc)


@router.patch("/menu/categories/{cat_id}")
async def update_category(cat_id: str, body: CategoryIn, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "categories", cat_id)
    res = await db.categories.find_one_and_update(tq(p, {"_id": cat_id}), {"$set": body.model_dump()}, return_document=True)
    return ser(res)


@router.delete("/menu/categories/{cat_id}")
async def delete_category(cat_id: str, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "categories", cat_id)
    if await db.menu_items.count_documents(tq(p, {"category_id": cat_id})) > 0:
        raise HTTPException(status_code=400, detail="Sposta o elimina prima i piatti della categoria")
    await db.categories.delete_one(tq(p, {"_id": cat_id}))
    return {"ok": True}


@router.get("/menu/items")
async def list_items(p: Principal = Depends(require_tenant())):
    return [ser(i) for i in await db.menu_items.find(tq(p)).sort("name", 1).to_list(500)]


@router.post("/menu/items", status_code=201)
async def create_item(body: MenuItemIn, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "categories", body.category_id)
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, **body.model_dump(), "created_at": now_iso()}
    await db.menu_items.insert_one(doc)
    return ser(doc)


@router.patch("/menu/items/{item_id}")
async def update_item(item_id: str, body: MenuItemUpdate, p: Principal = Depends(require_tenant())):
    await get_scoped_or_404(p, "menu_items", item_id)
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "category_id" in upd:
        await get_scoped_or_404(p, "categories", upd["category_id"])
    res = await db.menu_items.find_one_and_update(tq(p, {"_id": item_id}), {"$set": upd}, return_document=True)
    return ser(res)


@router.delete("/menu/items/{item_id}")
async def delete_item(item_id: str, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "menu_items", item_id)
    await db.menu_items.delete_one(tq(p, {"_id": item_id}))
    return {"ok": True}


# ---------- Orders / KDS ----------
class OrderStatusIn(BaseModel):
    status: str


@router.get("/orders")
async def list_orders(active: bool = True, p: Principal = Depends(require_tenant())):
    q = tq(p, {"status": {"$in": ["nuovo", "in_preparazione", "pronto"]}} if active else None)
    orders = await db.orders.find(q).sort("created_at", 1 if active else -1).to_list(500)
    return [ser(o) for o in orders]


@router.patch("/orders/{order_id}/status")
async def set_order_status(order_id: str, body: OrderStatusIn, p: Principal = Depends(require_tenant())):
    if body.status not in ORDER_STATUSES:
        raise HTTPException(status_code=400, detail="Stato non valido")
    order = await get_scoped_or_404(p, "orders", order_id)
    res = await db.orders.find_one_and_update(tq(p, {"_id": order_id}),
                                              {"$set": {"status": body.status, "updated_at": now_iso()}},
                                              return_document=True)
    if body.status in ("servito", "annullato"):
        remaining = await db.orders.count_documents(tq(p, {"table_id": order["table_id"],
                                                           "status": {"$in": ["nuovo", "in_preparazione", "pronto"]}}))
        if remaining == 0:
            await db.tables.update_one(tq(p, {"_id": order["table_id"], "status": "occupato"}),
                                       {"$set": {"status": "in_attesa_conto"}})
    return ser(res)


# ---------- Dashboard ----------
@router.get("/dashboard")
async def dashboard(p: Principal = Depends(require_tenant())):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    res_today = await db.reservations.find(tq(p, {"date": today, "status": {"$nin": ["annullata", "no_show"]}})).to_list(500)
    orders_today = await db.orders.find(tq(p, {"created_at": {"$gte": today}, "status": {"$ne": "annullato"}})).to_list(2000)
    tables = await db.tables.find(tq(p)).to_list(300)
    top = {}
    revenue = 0.0
    for o in orders_today:
        revenue += o.get("total", 0)
        for it in o.get("items", []):
            top[it["name"]] = top.get(it["name"], 0) + it["qty"]
    top_items = sorted(({"name": k, "qty": v} for k, v in top.items()), key=lambda x: -x["qty"])[:5]
    status_counts = {s: 0 for s in TABLE_STATUSES}
    for t in tables:
        status_counts[t.get("status", "libero")] = status_counts.get(t.get("status", "libero"), 0) + 1
    upcoming = sorted(res_today, key=lambda r: r["time"])[:6]
    return {
        "date": today,
        "reservations_today": len(res_today),
        "covers_today": sum(r["guests"] for r in res_today),
        "orders_today": len(orders_today),
        "open_orders": sum(1 for o in orders_today if o["status"] in ("nuovo", "in_preparazione", "pronto")),
        "revenue_today": round(revenue, 2),
        "tables": status_counts,
        "top_items": top_items,
        "upcoming": [ser(r) for r in upcoming],
    }
