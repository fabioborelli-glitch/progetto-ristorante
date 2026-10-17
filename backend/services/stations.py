from typing import Optional

DEFAULT_STATIONS = [
    {"id": "cucina", "name": "Cucina", "color": "#F59E0B"},
    {"id": "pizzeria", "name": "Pizzeria", "color": "#EF4444"},
    {"id": "bar", "name": "Bar", "color": "#3B82F6"},
]

ACTIVE = ("nuovo", "in_preparazione", "pronto")


def resolve_station(tenant: dict, item: dict, category: Optional[dict]) -> str:
    stations = tenant.get("stations") or DEFAULT_STATIONS
    valid = {s["id"] for s in stations}
    for candidate in (item.get("station_id"), (category or {}).get("station_id")):
        if candidate in valid:
            return candidate
    return stations[0]["id"]


def derive_order_status(stations: dict, current: str) -> str:
    if current in ("servito", "annullato") or not stations:
        return current
    vals = list(stations.values())
    if all(v == "pronto" for v in vals):
        return "pronto"
    if all(v == "nuovo" for v in vals):
        return "nuovo"
    return "in_preparazione"


def build_order_lines(tenant: dict, items: dict, cats: dict, raw_lines: list) -> tuple[list, dict]:
    """raw_lines: [{item, qty, variant, notes, price}] → (lines, stations map)."""
    lines, stations = [], {}
    for rl in raw_lines:
        it = rl["item"]
        sid = resolve_station(tenant, it, cats.get(it.get("category_id")))
        stations[sid] = "nuovo"
        lines.append({"item_id": it["_id"], "name": it["name"], "qty": rl["qty"], "variant": rl.get("variant"),
                      "notes": rl.get("notes") or "", "price": round(rl["price"], 2), "station_id": sid})
    return lines, stations
