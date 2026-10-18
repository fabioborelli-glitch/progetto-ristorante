"""Magazzino / inventory helpers: auto depletion from sales and stock math."""
from core import db, new_id, now_iso

DEFAULT_INV_CATEGORIES = [
    "Carne", "Pesce", "Verdura", "Frutta", "Latticini", "Uova", "Salumi",
    "Farine e cereali", "Pasta e riso", "Conserve e salse", "Spezie ed erbe",
    "Olio e aceto", "Bevande analcoliche", "Vino", "Birra", "Alcolici",
    "Surgelati", "Pane e dolci", "Materiale di consumo", "Altro",
]

UNITS = ["pz", "kg", "g", "l", "ml", "bt", "cf", "cl"]

MOVEMENT_TYPES = ["carico", "scarico", "rettifica", "spreco", "vendita", "reso"]


def stock_value(ingredients) -> float:
    return round(sum((i.get("quantity") or 0) * (i.get("cost_per_unit") or 0) for i in ingredients), 2)


async def record_movement(tenant_id: str, ingredient: dict, mtype: str, delta: float,
                           note: str = "", set_to: float = None, order_id: str = None):
    """Apply a stock change to an ingredient and log the movement.
    delta is the signed change applied to quantity (unless set_to given for rettifica)."""
    before = ingredient.get("quantity") or 0
    if set_to is not None:
        after = set_to
        delta = round(after - before, 4)
    else:
        after = round(before + delta, 4)
    cost = ingredient.get("cost_per_unit") or 0
    await db.ingredients.update_one({"_id": ingredient["_id"]}, {"$set": {"quantity": after, "updated_at": now_iso()}})
    mov = {"_id": new_id(), "tenant_id": tenant_id, "ingredient_id": ingredient["_id"],
           "ingredient_name": ingredient.get("name", ""), "type": mtype, "delta": delta,
           "before": before, "after": after, "unit": ingredient.get("unit", ""),
           "cost_per_unit": cost, "value": round(abs(delta) * cost, 2), "note": note or "",
           "order_id": order_id, "created_at": now_iso()}
    await db.stock_movements.insert_one(mov)
    return after


async def deplete_for_order(tenant_id: str, lines, order_id: str = None):
    """Decrement stock for sold dishes based on their recipes. lines: list with item_id & qty.
    Silent no-op for items without a recipe. Never blocks the sale."""
    try:
        item_qty = {}
        for l in lines:
            iid = l.get("item_id") if isinstance(l, dict) else getattr(l, "item_id", None)
            qty = l.get("qty") if isinstance(l, dict) else getattr(l, "qty", 1)
            if iid:
                item_qty[iid] = item_qty.get(iid, 0) + (qty or 1)
        if not item_qty:
            return
        recipes = {r["item_id"]: r for r in await db.recipes.find(
            {"tenant_id": tenant_id, "item_id": {"$in": list(item_qty.keys())}}).to_list(500)}
        need = {}  # ingredient_id -> qty to deplete
        for item_id, sold in item_qty.items():
            rec = recipes.get(item_id)
            if not rec:
                continue
            for rl in rec.get("lines", []):
                need[rl["ingredient_id"]] = need.get(rl["ingredient_id"], 0) + rl["qty"] * sold
        if not need:
            return
        ings = {i["_id"]: i for i in await db.ingredients.find(
            {"tenant_id": tenant_id, "_id": {"$in": list(need.keys())}}).to_list(500)}
        for ing_id, qty in need.items():
            ing = ings.get(ing_id)
            if ing and qty:
                await record_movement(tenant_id, ing, "vendita", -qty, note="Scarico da vendita", order_id=order_id)
    except Exception:
        pass
