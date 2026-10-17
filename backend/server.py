from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import os
import logging
import jwt
from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect
from starlette.middleware.cors import CORSMiddleware

from core import db, client, new_id, now_iso, hash_password, verify_password, JWT_ALGORITHM
from routers import auth, admin, tenant, public, invites, files, bills, cron
from routers.admin import tenant_doc
from services.ws import hub
from services.storage import init_storage
from services.stations import DEFAULT_STATIONS

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ristoos")

app = FastAPI(title="RistoOS API")
api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"app": "RistoOS", "status": "ok"}


api.include_router(auth.router)
api.include_router(admin.router)
api.include_router(tenant.router)
api.include_router(bills.router)
api.include_router(invites.router)
api.include_router(files.router)
api.include_router(cron.router)
api.include_router(public.router)
app.include_router(api)


@app.websocket("/api/ws")
async def ws_endpoint(ws: WebSocket, token: str, tenant_id: str | None = None):
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"_id": payload["sub"]})
    except Exception:
        user = None
    if not user:
        await ws.accept()
        await ws.close(code=4401)
        return
    room = user.get("tenant_id")
    if user.get("platform_role") == "superadmin" and tenant_id:
        room = tenant_id
    if not room:
        await ws.accept()
        await ws.close(code=4403)
        return
    await hub.connect(room, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        hub.disconnect(room, ws)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


async def upsert_user(email: str, password: str, name: str, **fields):
    email = email.lower()
    existing = await db.users.find_one({"email": email})
    if existing is None:
        await db.users.insert_one({"_id": new_id(), "email": email, "name": name, "password_hash": hash_password(password),
                                   "active": True, "created_at": now_iso(), **fields})
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password)}})


async def seed_demo_tenant():
    if await db.tenants.find_one({"slug": "trattoria-demo"}):
        return
    t = tenant_doc("Trattoria da Fabio", "trattoria-demo", "Milano")
    t.update({"address": "Via Roma 12, Milano", "phone": "+39 02 1234567",
              "description": "Cucina tradizionale italiana nel cuore di Milano."})
    await db.tenants.insert_one(t)
    tid = t["_id"]
    room_id = new_id()
    await db.rooms.insert_one({"_id": room_id, "tenant_id": tid, "name": "Sala principale", "sort": 0, "created_at": now_iso()})
    dehors_id = new_id()
    await db.rooms.insert_one({"_id": dehors_id, "tenant_id": tid, "name": "Dehors", "sort": 1, "created_at": now_iso()})
    tables = []
    for i in range(8):
        tables.append({"_id": new_id(), "tenant_id": tid, "room_id": room_id, "name": f"T{i + 1}",
                       "seats": 2 if i % 3 == 0 else 4, "shape": "round" if i % 2 else "square",
                       "x": 60 + (i % 4) * 180, "y": 60 + (i // 4) * 180, "code": f"DEMO{i + 1:02d}",
                       "status": "libero", "created_at": now_iso()})
    for i in range(3):
        tables.append({"_id": new_id(), "tenant_id": tid, "room_id": dehors_id, "name": f"D{i + 1}", "seats": 4,
                       "shape": "square", "x": 60 + i * 180, "y": 80, "code": f"DEMOD{i + 1}",
                       "status": "libero", "created_at": now_iso()})
    await db.tables.insert_many(tables)
    cats = [("Antipasti", "Starters"), ("Primi", "Pasta & Risotto"), ("Secondi", "Mains"), ("Dolci", "Desserts"), ("Bevande", "Drinks")]
    cat_ids = {}
    for i, (n, en) in enumerate(cats):
        cid = new_id()
        cat_ids[n] = cid
        await db.categories.insert_one({"_id": cid, "tenant_id": tid, "name": n, "name_en": en, "sort": i, "created_at": now_iso()})
    items = [
        ("Antipasti", "Tagliere di salumi e formaggi", "Selezione di salumi nostrani e formaggi stagionati", 14.0, ["latte"], [], ""),
        ("Antipasti", "Bruschette miste", "Pane tostato con pomodoro, olive e paté", 8.0, ["glutine"], [], ""),
        ("Primi", "Risotto alla milanese", "Riso Carnaroli, zafferano, midollo", 15.0, ["latte"], [], "https://images.pexels.com/photos/8864543/pexels-photo-8864543.jpeg?auto=compress&cs=tinysrgb&w=800"),
        ("Primi", "Spaghetti alla carbonara", "Guanciale, pecorino, uova, pepe", 13.0, ["glutine", "uova", "latte"], [{"name": "Senza glutine", "price_delta": 2.0}], ""),
        ("Primi", "Pizza Margherita", "Pomodoro San Marzano, fior di latte, basilico", 9.0, ["glutine", "latte"], [{"name": "Bufala", "price_delta": 3.0}, {"name": "Impasto integrale", "price_delta": 1.5}], "https://images.unsplash.com/photo-1534649643822-e7431de08af6?w=800&q=80"),
        ("Secondi", "Cotoletta alla milanese", "Costoletta di vitello impanata, patate al forno", 24.0, ["glutine", "uova"], [], ""),
        ("Secondi", "Tagliata di manzo", "Rucola, grana e riduzione di balsamico", 22.0, ["latte"], [{"name": "Al sangue", "price_delta": 0}, {"name": "Media", "price_delta": 0}, {"name": "Ben cotta", "price_delta": 0}], ""),
        ("Dolci", "Tiramisù della casa", "Savoiardi, mascarpone, caffè", 7.0, ["glutine", "uova", "latte"], [], ""),
        ("Dolci", "Panna cotta ai frutti di bosco", "", 6.0, ["latte"], [], ""),
        ("Bevande", "Acqua naturale 75cl", "", 2.5, [], [], ""),
        ("Bevande", "Acqua frizzante 75cl", "", 2.5, [], [], ""),
        ("Bevande", "Calice di vino rosso", "Barbera d'Asti DOCG", 6.0, ["solfiti"], [], ""),
        ("Bevande", "Birra artigianale 33cl", "", 5.0, ["glutine"], [], ""),
    ]
    for cat, name, desc, price, allergens, variants, img in items:
        await db.menu_items.insert_one({"_id": new_id(), "tenant_id": tid, "category_id": cat_ids[cat], "name": name,
                                        "name_en": "", "description": desc, "price": price, "allergens": allergens,
                                        "variants": variants, "available": True, "image_url": img, "created_at": now_iso()})
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for name, time, guests, status, phone in [("Rossi", "20:00", 4, "confermata", "+39 333 1112223"),
                                              ("Bianchi", "20:30", 2, "confermata", "+39 333 4445556"),
                                              ("Verdi", "13:00", 6, "in_attesa", "+39 333 7778889")]:
        await db.reservations.insert_one({"_id": new_id(), "tenant_id": tid, "date": today, "time": time, "guests": guests,
                                          "name": name, "phone": phone, "email": "", "notes": "", "table_id": None,
                                          "status": status, "source": "manuale", "created_at": now_iso()})
    return tid


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.tenants.create_index("slug", unique=True)
    await db.login_attempts.create_index("identifier")
    for coll in ["rooms", "tables", "reservations", "categories", "menu_items", "orders"]:
        await db[coll].create_index("tenant_id")
    await db.tables.create_index([("tenant_id", 1), ("code", 1)])
    await db.invites.create_index("token", unique=True)
    await db.bills.create_index([("tenant_id", 1), ("status", 1)])
    await db.files.create_index("tenant_id")
    await db.tenants.update_many({"stations": {"$exists": False}}, {"$set": {"stations": DEFAULT_STATIONS}})
    await db.categories.update_many({"name": {"$in": ["Pizze", "Pizza", "Pizzeria"]}, "station_id": {"$exists": False}}, {"$set": {"station_id": "pizzeria"}})
    await db.categories.update_many({"name": {"$in": ["Bevande", "Bar", "Vini", "Caffetteria"]}, "station_id": {"$exists": False}}, {"$set": {"station_id": "bar"}})
    await db.menu_items.update_many({"name": {"$regex": "^Pizza", "$options": "i"}, "station_id": {"$exists": False}}, {"$set": {"station_id": "pizzeria"}})
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    await upsert_user(os.environ["ADMIN_EMAIL"], os.environ["ADMIN_PASSWORD"], "Super Admin",
                      platform_role="superadmin", tenant_id=None, tenant_role=None)
    await seed_demo_tenant()
    demo = await db.tenants.find_one({"slug": "trattoria-demo"})
    if demo:
        await upsert_user(os.environ["DEMO_OWNER_EMAIL"], os.environ["DEMO_OWNER_PASSWORD"], "Fabio Owner",
                          platform_role=None, tenant_id=demo["_id"], tenant_role="owner")
    logger.info("RistoOS startup complete")


@app.on_event("shutdown")
async def shutdown():
    client.close()
