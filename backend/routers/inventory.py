from datetime import datetime, timezone, timedelta
import re
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from core import db, new_id, now_iso, ser, tq, get_scoped_or_404, require_tenant, Principal
from services.inventory import DEFAULT_INV_CATEGORIES, UNITS, stock_value, record_movement
from services.ocr import extract_invoice

router = APIRouter(prefix="/t", tags=["inventory"])


# ---------- Suppliers ----------
class SupplierIn(BaseModel):
    name: str
    phone: Optional[str] = ""
    email: Optional[str] = ""
    notes: Optional[str] = ""


@router.get("/suppliers")
async def list_suppliers(p: Principal = Depends(require_tenant())):
    return [ser(s) for s in await db.suppliers.find(tq(p)).sort("name", 1).to_list(1000)]


@router.post("/suppliers", status_code=201)
async def create_supplier(body: SupplierIn, p: Principal = Depends(require_tenant("manager"))):
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, **body.model_dump(), "created_at": now_iso()}
    await db.suppliers.insert_one(doc)
    return ser(doc)


@router.patch("/suppliers/{sid}")
async def update_supplier(sid: str, body: SupplierIn, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "suppliers", sid)
    res = await db.suppliers.find_one_and_update(tq(p, {"_id": sid}), {"$set": body.model_dump()}, return_document=True)
    return ser(res)


@router.delete("/suppliers/{sid}")
async def delete_supplier(sid: str, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "suppliers", sid)
    await db.suppliers.delete_one(tq(p, {"_id": sid}))
    await db.ingredients.update_many(tq(p, {"supplier_id": sid}), {"$set": {"supplier_id": None, "supplier_name": ""}})
    return {"ok": True}


# ---------- Ingredient categories ----------
@router.get("/inventory/categories")
async def inventory_categories(p: Principal = Depends(require_tenant())):
    t = await db.tenants.find_one({"_id": p.tenant_id})
    return t.get("inventory_categories") or DEFAULT_INV_CATEGORIES


@router.get("/inventory/units")
async def inventory_units():
    return UNITS


# ---------- Ingredients ----------
class IngredientIn(BaseModel):
    name: str
    category: str = "Altro"
    unit: str = "pz"
    cost_per_unit: float = 0
    quantity: float = 0
    min_stock: float = 0
    par_stock: float = 0
    barcode: Optional[str] = ""
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = ""
    not_in_pos: bool = False


class IngredientUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    cost_per_unit: Optional[float] = None
    min_stock: Optional[float] = None
    par_stock: Optional[float] = None
    barcode: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    not_in_pos: Optional[bool] = None
    clear_supplier: bool = False


@router.get("/ingredients")
async def list_ingredients(category: Optional[str] = None, q: Optional[str] = None,
                           filter: Optional[str] = None, p: Principal = Depends(require_tenant())):
    query = tq(p)
    if category and category != "all":
        query["category"] = category
    if q:
        rx = re.escape(q)
        query["$or"] = [{"name": {"$regex": rx, "$options": "i"}},
                        {"supplier_name": {"$regex": rx, "$options": "i"}},
                        {"barcode": q}]
    ings = await db.ingredients.find(query).sort("name", 1).to_list(5000)
    out = [ser(i) for i in ings]
    if filter == "low":
        out = [i for i in out if (i.get("min_stock") or 0) > 0 and (i.get("quantity") or 0) <= (i.get("min_stock") or 0)]
    elif filter == "reorder":
        out = [i for i in out if (i.get("min_stock") or 0) > 0 and (i.get("quantity") or 0) < (i.get("min_stock") or 0)]
    elif filter == "not_in_pos":
        out = [i for i in out if i.get("not_in_pos")]
    return out


@router.get("/ingredients/stats")
async def ingredient_stats(p: Principal = Depends(require_tenant())):
    ings = await db.ingredients.find(tq(p)).to_list(10000)
    reorder, low = [], 0
    reorder_value = 0.0
    for i in ings:
        ms = i.get("min_stock") or 0
        qt = i.get("quantity") or 0
        if ms > 0 and qt <= ms:
            low += 1
        if ms > 0 and qt < ms:
            target = i.get("par_stock") or ms
            reorder.append(i)
            reorder_value += max(target - qt, 0) * (i.get("cost_per_unit") or 0)
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    waste = await db.stock_movements.find(tq(p, {"type": {"$in": ["spreco", "rettifica"]}, "created_at": {"$gte": since}})).to_list(10000)
    waste_value = round(sum(w.get("value", 0) for w in waste if w.get("delta", 0) < 0), 2)
    last_count = await db.inventory_counts.find_one(tq(p), sort=[("created_at", -1)])
    cats = {}
    for i in ings:
        cats[i.get("category", "Altro")] = cats.get(i.get("category", "Altro"), 0) + 1
    return {
        "total": len(ings),
        "low_count": low,
        "reorder_count": len(reorder),
        "reorder_value": round(reorder_value, 2),
        "waste_30d": waste_value,
        "stock_value": stock_value(ings),
        "not_in_pos": sum(1 for i in ings if i.get("not_in_pos")),
        "last_count": last_count.get("created_at") if last_count else None,
        "by_category": cats,
    }


@router.post("/ingredients", status_code=201)
async def create_ingredient(body: IngredientIn, p: Principal = Depends(require_tenant("manager"))):
    data = body.model_dump()
    if data["unit"] not in UNITS:
        raise HTTPException(status_code=400, detail="Unità di misura non valida")
    if data.get("supplier_id"):
        s = await db.suppliers.find_one(tq(p, {"_id": data["supplier_id"]}))
        if s:
            data["supplier_name"] = s["name"]
    qty = data.pop("quantity", 0)
    if qty < 0:
        raise HTTPException(status_code=400, detail="La giacenza iniziale non può essere negativa")
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, **data, "quantity": 0, "created_at": now_iso(), "updated_at": now_iso()}
    await db.ingredients.insert_one(doc)
    if qty:
        await record_movement(p.tenant_id, doc, "carico", qty, note="Giacenza iniziale")
        doc["quantity"] = qty
    return ser(doc)


@router.patch("/ingredients/{ing_id}")
async def update_ingredient(ing_id: str, body: IngredientUpdate, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "ingredients", ing_id)
    upd = {k: v for k, v in body.model_dump(exclude={"clear_supplier"}).items() if v is not None}
    if upd.get("unit") and upd["unit"] not in UNITS:
        raise HTTPException(status_code=400, detail="Unità di misura non valida")
    if upd.get("supplier_id"):
        s = await db.suppliers.find_one(tq(p, {"_id": upd["supplier_id"]}))
        upd["supplier_name"] = s["name"] if s else ""
    if body.clear_supplier:
        upd["supplier_id"] = None
        upd["supplier_name"] = ""
    res = await db.ingredients.find_one_and_update(tq(p, {"_id": ing_id}), {"$set": upd}, return_document=True)
    return ser(res)


@router.delete("/ingredients/{ing_id}")
async def delete_ingredient(ing_id: str, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "ingredients", ing_id)
    await db.ingredients.delete_one(tq(p, {"_id": ing_id}))
    await db.recipes.update_many(tq(p), {"$pull": {"lines": {"ingredient_id": ing_id}}})
    return {"ok": True}


# ---------- Stock movements ----------
class MovementIn(BaseModel):
    type: str  # carico | scarico | spreco | rettifica | reso
    qty: float
    note: Optional[str] = ""


@router.post("/ingredients/{ing_id}/movement")
async def add_movement(ing_id: str, body: MovementIn, p: Principal = Depends(require_tenant())):
    ing = await get_scoped_or_404(p, "ingredients", ing_id)
    if body.type not in ("carico", "scarico", "spreco", "rettifica", "reso"):
        raise HTTPException(status_code=400, detail="Tipo movimento non valido")
    if body.type == "rettifica":
        if body.qty < 0:
            raise HTTPException(status_code=400, detail="La giacenza non può essere negativa")
        await record_movement(p.tenant_id, ing, "rettifica", 0, note=body.note or "Correzione manuale", set_to=body.qty)
    else:
        if body.qty <= 0:
            raise HTTPException(status_code=400, detail="La quantità deve essere maggiore di zero")
        sign = 1 if body.type in ("carico", "reso") else -1
        await record_movement(p.tenant_id, ing, body.type, sign * abs(body.qty), note=body.note or "")
    return ser(await db.ingredients.find_one({"_id": ing_id}))


@router.get("/ingredients/{ing_id}/movements")
async def list_movements(ing_id: str, p: Principal = Depends(require_tenant())):
    await get_scoped_or_404(p, "ingredients", ing_id)
    movs = await db.stock_movements.find(tq(p, {"ingredient_id": ing_id})).sort("created_at", -1).to_list(200)
    return [ser(m) for m in movs]


# ---------- Goods receiving (carico multiplo / consegna) ----------
class ReceiveLine(BaseModel):
    ingredient_id: str
    qty: float
    cost_per_unit: Optional[float] = None


class ReceiveIn(BaseModel):
    supplier_id: Optional[str] = None
    note: Optional[str] = ""
    lines: List[ReceiveLine]


@router.post("/inventory/receive", status_code=201)
async def receive_goods(body: ReceiveIn, p: Principal = Depends(require_tenant("manager"))):
    if not body.lines:
        raise HTTPException(status_code=400, detail="Nessun articolo da ricevere")
    ids = [l.ingredient_id for l in body.lines]
    ings = {i["_id"]: i for i in await db.ingredients.find(tq(p, {"_id": {"$in": ids}})).to_list(1000)}
    received = 0
    for l in body.lines:
        ing = ings.get(l.ingredient_id)
        if not ing or l.qty <= 0:
            continue
        if l.cost_per_unit is not None:
            await db.ingredients.update_one({"_id": ing["_id"]}, {"$set": {"cost_per_unit": l.cost_per_unit}})
            ing["cost_per_unit"] = l.cost_per_unit
        await record_movement(p.tenant_id, ing, "carico", abs(l.qty), note=body.note or "Ricevimento merce")
        received += 1
    return {"ok": True, "received": received}


# ---------- Inventory count session (sessione di conteggio) ----------
class CountLine(BaseModel):
    ingredient_id: str
    counted_qty: float


class CountIn(BaseModel):
    note: Optional[str] = ""
    lines: List[CountLine]


@router.post("/inventory/count", status_code=201)
async def apply_count(body: CountIn, p: Principal = Depends(require_tenant("manager"))):
    if not body.lines:
        raise HTTPException(status_code=400, detail="Nessun conteggio")
    ids = [l.ingredient_id for l in body.lines]
    ings = {i["_id"]: i for i in await db.ingredients.find(tq(p, {"_id": {"$in": ids}})).to_list(5000)}
    adjusted = 0
    for l in body.lines:
        ing = ings.get(l.ingredient_id)
        if not ing:
            continue
        if abs((ing.get("quantity") or 0) - l.counted_qty) > 1e-9:
            await record_movement(p.tenant_id, ing, "rettifica", 0, note="Sessione di inventario", set_to=l.counted_qty)
            adjusted += 1
    doc = {"_id": new_id(), "tenant_id": p.tenant_id, "note": body.note or "", "items": len(body.lines),
           "adjusted": adjusted, "created_at": now_iso()}
    await db.inventory_counts.insert_one(doc)
    return ser(doc)


# ---------- Recipes (collegamento piatto -> ingredienti) ----------
class RecipeLine(BaseModel):
    ingredient_id: str
    qty: float


class RecipeIn(BaseModel):
    lines: List[RecipeLine]


@router.get("/menu/items/{item_id}/recipe")
async def get_recipe(item_id: str, p: Principal = Depends(require_tenant())):
    await get_scoped_or_404(p, "menu_items", item_id)
    rec = await db.recipes.find_one(tq(p, {"item_id": item_id}))
    return {"item_id": item_id, "lines": rec.get("lines", []) if rec else []}


@router.put("/menu/items/{item_id}/recipe")
async def set_recipe(item_id: str, body: RecipeIn, p: Principal = Depends(require_tenant("manager"))):
    await get_scoped_or_404(p, "menu_items", item_id)
    lines = [{"ingredient_id": l.ingredient_id, "qty": l.qty} for l in body.lines if l.qty > 0]
    await db.recipes.update_one(tq(p, {"item_id": item_id}),
                                {"$set": {"lines": lines, "updated_at": now_iso()},
                                 "$setOnInsert": {"_id": new_id(), "tenant_id": p.tenant_id, "item_id": item_id}},
                                upsert=True)
    return {"item_id": item_id, "lines": lines}


@router.get("/menu/items/{item_id}/food-cost")
async def item_food_cost(item_id: str, p: Principal = Depends(require_tenant())):
    item = await get_scoped_or_404(p, "menu_items", item_id)
    rec = await db.recipes.find_one(tq(p, {"item_id": item_id}))
    cost = 0.0
    if rec:
        ids = [l["ingredient_id"] for l in rec.get("lines", [])]
        ings = {i["_id"]: i for i in await db.ingredients.find(tq(p, {"_id": {"$in": ids}})).to_list(1000)}
        for l in rec.get("lines", []):
            ing = ings.get(l["ingredient_id"])
            if ing:
                cost += (ing.get("cost_per_unit") or 0) * l["qty"]
    price = item.get("price") or 0
    return {"item_id": item_id, "cost": round(cost, 2), "price": price,
            "margin": round(price - cost, 2),
            "food_cost_pct": round(cost / price * 100, 1) if price else None}


# ---------- Food cost (bulk) ----------
@router.get("/food-cost")
async def food_cost_all(p: Principal = Depends(require_tenant("manager"))):
    items = await db.menu_items.find(tq(p)).sort("name", 1).to_list(1000)
    cats = {c["_id"]: c["name"] for c in await db.categories.find(tq(p)).to_list(200)}
    recipes = {r["item_id"]: r for r in await db.recipes.find(tq(p)).to_list(2000)}
    ings = {i["_id"]: i for i in await db.ingredients.find(tq(p)).to_list(10000)}
    out = []
    for it in items:
        rec = recipes.get(it["_id"])
        cost = 0.0
        has_recipe = bool(rec and rec.get("lines"))
        if rec:
            for l in rec.get("lines", []):
                ing = ings.get(l["ingredient_id"])
                if ing:
                    cost += (ing.get("cost_per_unit") or 0) * l["qty"]
        price = it.get("price") or 0
        out.append({
            "item_id": it["_id"], "name": it["name"], "category": cats.get(it.get("category_id"), ""),
            "price": price, "cost": round(cost, 2), "margin": round(price - cost, 2),
            "food_cost_pct": round(cost / price * 100, 1) if price and has_recipe else None,
            "has_recipe": has_recipe,
        })
    with_recipe_items = [o for o in out if o["has_recipe"]]
    priced = [o for o in with_recipe_items if o["price"]]
    avg = round(sum(o["food_cost_pct"] for o in priced) / len(priced), 1) if priced else None
    return {"items": out, "summary": {"total": len(out), "with_recipe": len(with_recipe_items),
            "without_recipe": len(out) - len(with_recipe_items), "avg_food_cost_pct": avg}}


# ---------- Invoice OCR (fatture) ----------
@router.post("/invoices/scan")
async def scan_invoice(file: UploadFile = File(...), p: Principal = Depends(require_tenant("manager"))):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Carica una foto della fattura (JPEG/PNG)")
    data = await file.read()
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Immagine troppo grande (max 12MB)")
    try:
        parsed = await extract_invoice(data, file.content_type)
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    ings = await db.ingredients.find(tq(p)).to_list(10000)
    by_name = {i["name"].lower().strip(): i for i in ings}
    for l in parsed["lines"]:
        key = l["name"].lower().strip()
        match = by_name.get(key)
        if not match:
            match = next((i for i in ings if key and (key in i["name"].lower() or i["name"].lower() in key)), None)
        l["ingredient_id"] = match["_id"] if match else None
        l["matched_name"] = match["name"] if match else None
    return parsed


class InvoiceApplyLine(BaseModel):
    name: str
    ingredient_id: Optional[str] = None  # existing ingredient to receive into
    qty: float
    unit: Optional[str] = "pz"
    unit_cost: Optional[float] = None
    category: Optional[str] = "Altro"
    create_new: bool = False


class InvoiceApplyIn(BaseModel):
    supplier_name: Optional[str] = ""
    lines: List[InvoiceApplyLine]


@router.post("/invoices/apply", status_code=201)
async def apply_invoice(body: InvoiceApplyIn, p: Principal = Depends(require_tenant("manager"))):
    if not body.lines:
        raise HTTPException(status_code=400, detail="Nessuna riga da applicare")
    supplier_id = None
    if body.supplier_name:
        s = await db.suppliers.find_one(tq(p, {"name": {"$regex": f"^{re.escape(body.supplier_name.strip())}$", "$options": "i"}}))
        if not s:
            s = {"_id": new_id(), "tenant_id": p.tenant_id, "name": body.supplier_name.strip(),
                 "phone": "", "email": "", "notes": "", "created_at": now_iso()}
            await db.suppliers.insert_one(s)
        supplier_id = s["_id"]
    created, received = 0, 0
    for l in body.lines:
        if l.qty <= 0:
            continue
        ing = None
        if l.ingredient_id:
            ing = await db.ingredients.find_one(tq(p, {"_id": l.ingredient_id}))
        if not ing and l.create_new:
            unit = l.unit if l.unit in UNITS else "pz"
            ing = {"_id": new_id(), "tenant_id": p.tenant_id, "name": l.name.strip(), "category": l.category or "Altro",
                   "unit": unit, "cost_per_unit": l.unit_cost or 0, "min_stock": 0, "par_stock": 0, "barcode": "",
                   "supplier_id": supplier_id, "supplier_name": body.supplier_name or "", "not_in_pos": False,
                   "quantity": 0, "created_at": now_iso(), "updated_at": now_iso()}
            await db.ingredients.insert_one(ing)
            created += 1
        if not ing:
            continue
        if l.unit_cost is not None:
            await db.ingredients.update_one({"_id": ing["_id"]}, {"$set": {"cost_per_unit": l.unit_cost}})
            ing["cost_per_unit"] = l.unit_cost
        if supplier_id and not ing.get("supplier_id"):
            await db.ingredients.update_one({"_id": ing["_id"]}, {"$set": {"supplier_id": supplier_id, "supplier_name": body.supplier_name or ""}})
        await record_movement(p.tenant_id, ing, "carico", abs(l.qty), note=f"Fattura {body.supplier_name or ''}".strip())
        received += 1
    return {"ok": True, "created": created, "received": received}
