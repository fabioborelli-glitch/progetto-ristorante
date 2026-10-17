import io
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel
from reportlab.lib.pagesizes import mm
from reportlab.pdfgen import canvas
from core import db, new_id, now_iso, ser, tq, get_scoped_or_404, require_tenant, Principal
from services.ws import hub

router = APIRouter(prefix="/t/bills", tags=["bills"])

PAY_METHODS = ["contanti", "carta"]
ACTIVE_ORDER = {"$in": ["nuovo", "in_preparazione", "pronto"]}


def compute(bill: dict) -> dict:
    subtotal = round(sum(l["qty"] * l["price"] for l in bill.get("lines", [])), 2)
    dt, dv = bill.get("discount_type"), float(bill.get("discount_value") or 0)
    discount = round(subtotal * dv / 100, 2) if dt == "percent" else (min(dv, subtotal) if dt == "amount" else 0.0)
    total = round(subtotal - discount, 2)
    paid = round(sum(pm["amount"] for pm in bill.get("payments", [])), 2)
    bill.update({"subtotal": subtotal, "discount_amount": round(discount, 2), "total": total, "paid": paid,
                 "remaining": round(total - paid, 2)})
    return bill


async def sync_orders(p: Principal, bill: dict) -> dict:
    if bill["status"] != "aperto" or bill.get("parent_id"):
        return bill
    orders = await db.orders.find(tq(p, {"table_id": bill["table_id"], "bill_id": None, "status": {"$ne": "annullato"}})).to_list(200)
    if not orders:
        return bill
    lines = list(bill.get("lines", []))
    for o in orders:
        for i, it in enumerate(o["items"]):
            lines.append({"key": f"{o['_id']}:{i}", "order_id": o["_id"], "item_id": it["item_id"], "name": it["name"],
                          "variant": it.get("variant"), "qty": it["qty"], "price": it["price"]})
        await db.orders.update_one({"_id": o["_id"]}, {"$set": {"bill_id": bill["_id"]}})
    await db.bills.update_one({"_id": bill["_id"]}, {"$set": {"lines": lines}})
    bill["lines"] = lines
    return bill


async def load_bill(p: Principal, bill_id: str) -> dict:
    bill = await get_scoped_or_404(p, "bills", bill_id)
    return compute(await sync_orders(p, bill))


def out(bill: dict) -> dict:
    return ser(compute(bill))


@router.get("")
async def list_open(p: Principal = Depends(require_tenant())):
    bills = await db.bills.find(tq(p, {"status": "aperto"})).sort("opened_at", 1).to_list(200)
    return [out(await sync_orders(p, b)) for b in bills]


@router.get("/history")
async def history(date: Optional[str] = None, p: Principal = Depends(require_tenant())):
    date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    bills = await db.bills.find(tq(p, {"status": "chiuso", "closed_at": {"$gte": date + "T00:00:00", "$lte": date + "T23:59:59.999999+00:00"}})).sort("closed_at", -1).to_list(500)
    res = [out(b) for b in bills]
    by_method = {}
    for b in res:
        for pm in b["payments"]:
            by_method[pm["method"]] = round(by_method.get(pm["method"], 0) + pm["amount"], 2)
    return {"date": date, "count": len(res), "total": round(sum(b["total"] for b in res), 2),
            "by_method": by_method, "bills": res}


class OpenIn(BaseModel):
    table_id: str
    covers: Optional[int] = None


@router.post("/open", status_code=201)
async def open_bill(body: OpenIn, p: Principal = Depends(require_tenant())):
    table = await get_scoped_or_404(p, "tables", body.table_id)
    existing = await db.bills.find_one(tq(p, {"table_id": table["_id"], "status": "aperto", "parent_id": None}))
    if existing:
        return out(await sync_orders(p, existing))
    bill = {"_id": new_id(), "tenant_id": p.tenant_id, "table_id": table["_id"], "table_name": table["name"],
            "number": None, "status": "aperto", "lines": [], "discount_type": None, "discount_value": 0,
            "covers": body.covers or table.get("seats", 0), "notes": "", "payments": [], "parent_id": None,
            "opened_by": p.user_id, "opened_at": now_iso(), "closed_at": None}
    await db.bills.insert_one(bill)
    if table["status"] == "libero":
        await db.tables.update_one({"_id": table["_id"]}, {"$set": {"status": "occupato"}})
        await hub.emit(p.tenant_id, "tables_changed")
    bill = await sync_orders(p, bill)
    await hub.emit(p.tenant_id, "bills_changed")
    return out(bill)


@router.get("/{bill_id}")
async def get_bill(bill_id: str, p: Principal = Depends(require_tenant())):
    return ser(await load_bill(p, bill_id))


class BillPatch(BaseModel):
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    covers: Optional[int] = None
    notes: Optional[str] = None
    clear_discount: bool = False


@router.patch("/{bill_id}")
async def patch_bill(bill_id: str, body: BillPatch, p: Principal = Depends(require_tenant())):
    bill = await load_bill(p, bill_id)
    if bill["status"] != "aperto":
        raise HTTPException(status_code=400, detail="Conto già chiuso")
    upd = {}
    if body.clear_discount:
        upd.update({"discount_type": None, "discount_value": 0})
    elif body.discount_type is not None:
        if body.discount_type not in ("percent", "amount"):
            raise HTTPException(status_code=400, detail="Tipo sconto non valido")
        upd.update({"discount_type": body.discount_type, "discount_value": max(0.0, body.discount_value or 0)})
    if body.covers is not None:
        upd["covers"] = body.covers
    if body.notes is not None:
        upd["notes"] = body.notes
    res = await db.bills.find_one_and_update({"_id": bill_id}, {"$set": upd}, return_document=True)
    await hub.emit(p.tenant_id, "bills_changed")
    return out(res)


class AddItem(BaseModel):
    item_id: str
    qty: int = 1
    variant: Optional[str] = None
    notes: Optional[str] = ""
    send_to_kitchen: bool = True


@router.post("/{bill_id}/items")
async def add_item(bill_id: str, body: AddItem, p: Principal = Depends(require_tenant())):
    bill = await load_bill(p, bill_id)
    if bill["status"] != "aperto":
        raise HTTPException(status_code=400, detail="Conto già chiuso")
    item = await get_scoped_or_404(p, "menu_items", body.item_id)
    price = item["price"]
    if body.variant:
        v = next((v for v in item.get("variants", []) if v["name"] == body.variant), None)
        if not v:
            raise HTTPException(status_code=400, detail="Variante non valida")
        price += v["price_delta"]
    if body.qty < 1:
        raise HTTPException(status_code=400, detail="Quantità non valida")
    qty = body.qty
    order = {"_id": new_id(), "tenant_id": p.tenant_id, "table_id": bill["table_id"], "table_name": bill["table_name"],
             "customer_name": "Cassa", "notes": "", "bill_id": bill_id,
             "items": [{"item_id": item["_id"], "name": item["name"], "qty": qty, "variant": body.variant,
                        "notes": body.notes or "", "price": round(price, 2)}],
             "total": round(price * qty, 2), "status": "nuovo" if body.send_to_kitchen else "servito",
             "source": "cassa", "created_at": now_iso(), "updated_at": now_iso()}
    await db.orders.insert_one(order)
    line = {"key": f"{order['_id']}:0", "order_id": order["_id"], "item_id": item["_id"], "name": item["name"],
            "variant": body.variant, "qty": qty, "price": round(price, 2)}
    res = await db.bills.find_one_and_update({"_id": bill_id}, {"$push": {"lines": line}}, return_document=True)
    await hub.emit(p.tenant_id, "orders_changed")
    await hub.emit(p.tenant_id, "bills_changed")
    return out(res)


@router.delete("/{bill_id}/lines/{key}")
async def remove_line(bill_id: str, key: str, p: Principal = Depends(require_tenant("manager"))):
    bill = await load_bill(p, bill_id)
    if bill["status"] != "aperto":
        raise HTTPException(status_code=400, detail="Conto già chiuso")
    lines = [l for l in bill["lines"] if l["key"] != key]
    if len(lines) == len(bill["lines"]):
        raise HTTPException(status_code=404, detail="Riga non trovata")
    res = await db.bills.find_one_and_update({"_id": bill_id}, {"$set": {"lines": lines}}, return_document=True)
    await hub.emit(p.tenant_id, "bills_changed")
    return out(res)


class SplitLine(BaseModel):
    key: str
    qty: int


class SplitIn(BaseModel):
    lines: List[SplitLine]


@router.post("/{bill_id}/split", status_code=201)
async def split_bill(bill_id: str, body: SplitIn, p: Principal = Depends(require_tenant())):
    bill = await load_bill(p, bill_id)
    if bill["status"] != "aperto":
        raise HTTPException(status_code=400, detail="Conto già chiuso")
    wanted = {l.key: l.qty for l in body.lines if l.qty > 0}
    if not wanted:
        raise HTTPException(status_code=400, detail="Seleziona almeno una riga")
    keep, moved = [], []
    for l in bill["lines"]:
        q = min(wanted.get(l["key"], 0), l["qty"])
        if q > 0:
            moved.append({**l, "qty": q})
            if l["qty"] - q > 0:
                keep.append({**l, "qty": l["qty"] - q})
        else:
            keep.append(l)
    if not keep:
        raise HTTPException(status_code=400, detail="Non puoi spostare tutte le righe")
    child = {"_id": new_id(), "tenant_id": p.tenant_id, "table_id": bill["table_id"], "table_name": bill["table_name"],
             "number": None, "status": "aperto", "lines": moved, "discount_type": None, "discount_value": 0,
             "covers": 0, "notes": "", "payments": [], "parent_id": bill_id, "opened_by": p.user_id,
             "opened_at": now_iso(), "closed_at": None}
    await db.bills.insert_one(child)
    await db.bills.update_one({"_id": bill_id}, {"$set": {"lines": keep}})
    await hub.emit(p.tenant_id, "bills_changed")
    return out(child)


class PaymentIn(BaseModel):
    method: str
    amount: float


@router.post("/{bill_id}/payments")
async def add_payment(bill_id: str, body: PaymentIn, p: Principal = Depends(require_tenant())):
    bill = await load_bill(p, bill_id)
    if bill["status"] != "aperto":
        raise HTTPException(status_code=400, detail="Conto già chiuso")
    if body.method not in PAY_METHODS:
        raise HTTPException(status_code=400, detail="Metodo non valido")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Importo non valido")
    pm = {"id": new_id(), "method": body.method, "amount": round(body.amount, 2), "at": now_iso()}
    res = await db.bills.find_one_and_update({"_id": bill_id}, {"$push": {"payments": pm}}, return_document=True)
    await hub.emit(p.tenant_id, "bills_changed")
    return out(res)


@router.delete("/{bill_id}/payments/{payment_id}")
async def remove_payment(bill_id: str, payment_id: str, p: Principal = Depends(require_tenant())):
    bill = await load_bill(p, bill_id)
    if bill["status"] != "aperto":
        raise HTTPException(status_code=400, detail="Conto già chiuso")
    res = await db.bills.find_one_and_update({"_id": bill_id}, {"$pull": {"payments": {"id": payment_id}}}, return_document=True)
    await hub.emit(p.tenant_id, "bills_changed")
    return out(res)


async def next_number(tenant_id: str) -> str:
    year = datetime.now(timezone.utc).year
    c = await db.counters.find_one_and_update({"_id": f"bill:{tenant_id}:{year}"}, {"$inc": {"seq": 1}},
                                              upsert=True, return_document=True)
    return f"{year}/{c['seq']:05d}"


@router.post("/{bill_id}/close")
async def close_bill(bill_id: str, p: Principal = Depends(require_tenant())):
    bill = await load_bill(p, bill_id)
    if bill["status"] != "aperto":
        raise HTTPException(status_code=400, detail="Conto già chiuso")
    if not bill["lines"]:
        raise HTTPException(status_code=400, detail="Il conto è vuoto")
    if bill["remaining"] > 0.009:
        raise HTTPException(status_code=400, detail=f"Mancano {bill['remaining']:.2f} € da incassare")
    number = await next_number(p.tenant_id)
    res = await db.bills.find_one_and_update({"_id": bill_id}, {"$set": {"status": "chiuso", "number": number,
                                                                        "closed_at": now_iso(), "closed_by": p.user_id}},
                                             return_document=True)
    order_ids = list({l["order_id"] for l in bill["lines"] if l.get("order_id")})
    await db.orders.update_many({"_id": {"$in": order_ids}, "status": ACTIVE_ORDER},
                                {"$set": {"status": "servito", "updated_at": now_iso()}})
    still_open = await db.bills.count_documents(tq(p, {"table_id": bill["table_id"], "status": "aperto"}))
    if still_open == 0:
        await db.tables.update_one({"_id": bill["table_id"]}, {"$set": {"status": "libero"}})
    await hub.emit(p.tenant_id, "bills_changed")
    await hub.emit(p.tenant_id, "orders_changed")
    await hub.emit(p.tenant_id, "tables_changed")
    return out(res)


@router.delete("/{bill_id}")
async def cancel_bill(bill_id: str, p: Principal = Depends(require_tenant("manager"))):
    bill = await load_bill(p, bill_id)
    if bill["status"] != "aperto":
        raise HTTPException(status_code=400, detail="Conto già chiuso")
    if bill["payments"]:
        raise HTTPException(status_code=400, detail="Rimuovi prima i pagamenti registrati")
    if bill.get("parent_id"):
        parent = await db.bills.find_one(tq(p, {"_id": bill["parent_id"], "status": "aperto"}))
        if parent:
            await db.bills.update_one({"_id": parent["_id"]}, {"$push": {"lines": {"$each": bill["lines"]}}})
    else:
        order_ids = list({l["order_id"] for l in bill["lines"] if l.get("order_id")})
        await db.orders.update_many({"_id": {"$in": order_ids}}, {"$set": {"bill_id": None}})
    await db.bills.delete_one({"_id": bill_id})
    await hub.emit(p.tenant_id, "bills_changed")
    return {"ok": True}


@router.get("/{bill_id}/receipt.pdf")
async def receipt(bill_id: str, p: Principal = Depends(require_tenant())):
    bill = await load_bill(p, bill_id)
    tenant = await db.tenants.find_one({"_id": p.tenant_id})
    buf = io.BytesIO()
    w = 80 * mm
    lines_count = len(bill["lines"]) + len(bill["payments"]) + 22
    h = max(120 * mm, lines_count * 5.2 * mm)
    c = canvas.Canvas(buf, pagesize=(w, h))
    y = h - 10 * mm
    x = 5 * mm
    xr = w - 5 * mm

    def line(txt, size=8, bold=False, align="left", dy=4.6 * mm):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        if align == "center":
            c.drawCentredString(w / 2, y, txt)
        elif align == "right":
            c.drawRightString(xr, y, txt)
        else:
            c.drawString(x, y, txt)
        y -= dy

    def row(left, right, size=8, bold=False):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(x, y, left[:34])
        c.drawRightString(xr, y, right)
        y -= 4.6 * mm

    def rule():
        nonlocal y
        c.setDash(1, 2)
        c.line(x, y + 1.5 * mm, xr, y + 1.5 * mm)
        c.setDash()
        y -= 2.5 * mm

    line(tenant["name"], 12, True, "center", 6 * mm)
    for extra in [tenant.get("address"), tenant.get("city"), tenant.get("phone")]:
        if extra:
            line(extra, 7, align="center", dy=3.8 * mm)
    y -= 2 * mm
    line("DOCUMENTO NON FISCALE", 8, True, "center")
    line("Scontrino di cortesia", 7, align="center")
    rule()
    when = datetime.fromisoformat(bill["closed_at"] or now_iso()).strftime("%d/%m/%Y %H:%M")
    row(f"Tavolo {bill['table_name']}", when, 8)
    if bill.get("number"):
        row(f"Conto n. {bill['number']}", f"Coperti {bill.get('covers') or '-'}", 7)
    rule()
    for l in bill["lines"]:
        name = l["name"] + (f" ({l['variant']})" if l.get("variant") else "")
        row(f"{l['qty']} x {name}", f"{l['qty'] * l['price']:.2f}")
    rule()
    row("Subtotale", f"{bill['subtotal']:.2f} EUR")
    if bill["discount_amount"] > 0:
        label = f"Sconto {bill['discount_value']:.0f}%" if bill["discount_type"] == "percent" else "Sconto"
        row(label, f"-{bill['discount_amount']:.2f} EUR")
    row("TOTALE", f"{bill['total']:.2f} EUR", 11, True)
    if bill["payments"]:
        y -= 1 * mm
        for pm in bill["payments"]:
            row(f"Pagato {pm['method']}", f"{pm['amount']:.2f} EUR", 7)
    y -= 3 * mm
    line("Grazie e arrivederci!", 8, True, "center")
    line("Documento non valido ai fini fiscali", 6, align="center")
    c.showPage()
    c.save()
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=scontrino-{(bill.get('number') or bill_id[:8]).replace('/', '-')}.pdf"})
