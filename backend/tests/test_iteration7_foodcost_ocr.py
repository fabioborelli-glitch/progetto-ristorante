"""Iteration 7: Food cost page API, stock restore on order cancel (idempotent), invoice OCR scan/apply,
permissions (staff 403) and multi-tenant isolation."""
import os
import uuid
import requests
import pytest
from make_invoice import make

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
OWNER = {"email": "owner@trattoria-demo.it", "password": "Demo2026!"}
SUPER = {"email": "fabio.borelli@icloud.com", "password": "RistoOS2026!"}


def login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def H():
    return login(OWNER)


@pytest.fixture(scope="module")
def bag(H):
    b = {"ings": [], "sups": [], "users": []}
    yield b
    for i in b["ings"]:
        requests.delete(f"{API}/t/ingredients/{i}", headers=H, timeout=15)
    for s in b["sups"]:
        requests.delete(f"{API}/t/suppliers/{s}", headers=H, timeout=15)
    for u in b["users"]:
        requests.delete(f"{API}/t/users/{u}", headers=H, timeout=15)


def mk_ing(H, bag, **kw):
    body = {"name": f"TEST_ing_{uuid.uuid4().hex[:6]}", "category": "Verdura", "unit": "kg",
            "cost_per_unit": 2.0, "quantity": 10}
    body.update(kw)
    r = requests.post(f"{API}/t/ingredients", headers=H, json=body, timeout=15)
    assert r.status_code == 201, r.text
    bag["ings"].append(r.json()["id"])
    return r.json()


def get_ing(H, iid):
    return next((i for i in requests.get(f"{API}/t/ingredients", headers=H, timeout=15).json() if i["id"] == iid), None)


def pick_item(H):
    items = requests.get(f"{API}/t/menu/items", headers=H, timeout=15).json()
    it = next((i for i in items if i.get("available", True) and not i.get("variants") and (i.get("price") or 0) > 0), None)
    if not it:
        pytest.skip("no menu item")
    return it


# Food cost bulk endpoint
class TestFoodCost:
    def test_food_cost_structure_and_values(self, H, bag):
        it = pick_item(H)
        old = requests.get(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, timeout=15).json()["lines"]
        ing = mk_ing(H, bag, cost_per_unit=4.0)
        try:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H,
                         json={"lines": [{"ingredient_id": ing["id"], "qty": 0.5}]}, timeout=15)
            r = requests.get(f"{API}/t/food-cost", headers=H, timeout=15)
            assert r.status_code == 200
            d = r.json()
            assert set(d["summary"].keys()) == {"total", "with_recipe", "without_recipe", "avg_food_cost_pct"}
            assert d["summary"]["total"] == len(d["items"])
            assert d["summary"]["with_recipe"] + d["summary"]["without_recipe"] == d["summary"]["total"]
            row = next(x for x in d["items"] if x["item_id"] == it["id"])
            assert row["has_recipe"] is True
            assert abs(row["cost"] - 2.0) < 0.01
            assert abs(row["margin"] - round(it["price"] - 2.0, 2)) < 0.01
            assert abs(row["food_cost_pct"] - round(2.0 / it["price"] * 100, 1)) < 0.05
            no_rec = [x for x in d["items"] if not x["has_recipe"]]
            assert all(x["food_cost_pct"] is None for x in no_rec)
            wr = [x for x in d["items"] if x["has_recipe"] and x["price"]]
            exp = round(sum(x["food_cost_pct"] for x in wr) / len(wr), 1)
            assert d["summary"]["avg_food_cost_pct"] == exp
            assert "_id" not in row
        finally:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, json={"lines": old}, timeout=15)


# Stock restore on order cancel
class TestRestore:
    def test_cancel_restores_and_idempotent(self, H, bag):
        it = pick_item(H)
        old = requests.get(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, timeout=15).json()["lines"]
        ing = mk_ing(H, bag, quantity=9.1, cost_per_unit=3)
        try:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H,
                         json={"lines": [{"ingredient_id": ing["id"], "qty": 0.3}]}, timeout=15)
            tables = requests.get(f"{API}/t/tables", headers=H, timeout=15).json()
            t = next((x for x in tables if x["name"] == "D3"), tables[0])
            o = requests.post(f"{API}/t/orders", headers=H, json={"table_id": t["id"], "lines": [{"item_id": it["id"], "qty": 3}],
                              "client_id": f"c-TEST-{uuid.uuid4().hex[:8]}"}, timeout=15)
            assert o.status_code == 201, o.text
            oid = o.json()["id"]
            assert abs(get_ing(H, ing["id"])["quantity"] - 8.2) < 1e-6
            r = requests.patch(f"{API}/t/orders/{oid}/status", headers=H, json={"status": "annullato"}, timeout=15)
            assert r.status_code == 200 and r.json()["status"] == "annullato"
            assert abs(get_ing(H, ing["id"])["quantity"] - 9.1) < 1e-6
            movs = requests.get(f"{API}/t/ingredients/{ing['id']}/movements", headers=H, timeout=15).json()
            assert movs[0]["type"] == "reso" and movs[0]["order_id"] == oid and abs(movs[0]["delta"] - 0.9) < 1e-6
            # cancel again -> no double restore
            requests.patch(f"{API}/t/orders/{oid}/status", headers=H, json={"status": "annullato"}, timeout=15)
            assert abs(get_ing(H, ing["id"])["quantity"] - 9.1) < 1e-6
            # flip back and cancel again -> still idempotent
            requests.patch(f"{API}/t/orders/{oid}/status", headers=H, json={"status": "nuovo"}, timeout=15)
            requests.patch(f"{API}/t/orders/{oid}/status", headers=H, json={"status": "annullato"}, timeout=15)
            assert abs(get_ing(H, ing["id"])["quantity"] - 9.1) < 1e-6
            resos = [m for m in requests.get(f"{API}/t/ingredients/{ing['id']}/movements", headers=H, timeout=15).json() if m["type"] == "reso"]
            assert len(resos) == 1
        finally:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, json={"lines": old}, timeout=15)

    def test_served_order_not_restored(self, H, bag):
        it = pick_item(H)
        old = requests.get(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, timeout=15).json()["lines"]
        ing = mk_ing(H, bag, quantity=5)
        try:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H,
                         json={"lines": [{"ingredient_id": ing["id"], "qty": 1}]}, timeout=15)
            tables = requests.get(f"{API}/t/tables", headers=H, timeout=15).json()
            t = next((x for x in tables if x["name"] == "D3"), tables[0])
            o = requests.post(f"{API}/t/orders", headers=H, json={"table_id": t["id"], "lines": [{"item_id": it["id"], "qty": 1}]}, timeout=15)
            oid = o.json()["id"]
            requests.patch(f"{API}/t/orders/{oid}/status", headers=H, json={"status": "servito"}, timeout=15)
            assert abs(get_ing(H, ing["id"])["quantity"] - 4) < 1e-6
        finally:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, json={"lines": old}, timeout=15)


# Invoice OCR scan (real Gemini call)
class TestInvoiceScan:
    def test_scan_extracts_and_matches(self, H, bag):
        ing = mk_ing(H, bag, name="Zucchine", cost_per_unit=1.0, quantity=0)  # OCR drops TEST_ prefix; cleaned up by fixture
        path = make("/tmp/inv_test.jpg")
        with open(path, "rb") as f:
            r = requests.post(f"{API}/t/invoices/scan", headers=H, files={"file": ("fattura.jpg", f, "image/jpeg")}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        print(d)
        assert "bianchi" in (d.get("supplier_name") or "").lower()
        assert d.get("date") == "2026-01-15"
        assert "0457" in (d.get("document_number") or "")
        assert len(d["lines"]) == 3
        z = next(l for l in d["lines"] if "zucchine" in l["name"].lower())
        assert z["qty"] == 5 and z["unit"] == "kg" and abs(z["unit_cost"] - 2.4) < 0.01
        assert z["ingredient_id"] == ing["id"]
        b = next(l for l in d["lines"] if "basilico" in l["name"].lower())
        assert abs(b["unit_cost"] - 1.5) < 0.01

    def test_scan_png(self, H):
        path = make("/tmp/inv_test.png")
        with open(path, "rb") as f:
            r = requests.post(f"{API}/t/invoices/scan", headers=H, files={"file": ("fattura.png", f, "image/png")}, timeout=90)
        assert r.status_code == 200, r.text
        assert len(r.json()["lines"]) >= 3

    def test_scan_rejects_non_image(self, H):
        r = requests.post(f"{API}/t/invoices/scan", headers=H, files={"file": ("x.txt", b"hello", "text/plain")}, timeout=30)
        assert r.status_code == 400

    def test_scan_blank_image(self, H):
        from PIL import Image
        Image.new("RGB", (400, 300), "white").save("/tmp/blank.jpg")
        with open("/tmp/blank.jpg", "rb") as f:
            r = requests.post(f"{API}/t/invoices/scan", headers=H, files={"file": ("b.jpg", f, "image/jpeg")}, timeout=90)
        print(r.status_code, r.text[:300])
        assert r.status_code in (200, 422)
        if r.status_code == 200:
            assert r.json()["lines"] == []


# Invoice apply
class TestInvoiceApply:
    def test_apply_mixed(self, H, bag):
        ing = mk_ing(H, bag, cost_per_unit=1.0, quantity=2)
        sup = f"TEST_Sup_{uuid.uuid4().hex[:6]}"
        new_name = f"TEST_Mozzarella_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/t/invoices/apply", headers=H, json={"supplier_name": sup, "lines": [
            {"name": ing["name"], "ingredient_id": ing["id"], "qty": 10, "unit": "kg", "unit_cost": 1.2},
            {"name": new_name, "qty": 4, "unit": "kg", "unit_cost": 8.5, "category": "Latticini", "create_new": True},
            {"name": "TEST_skip", "qty": 3, "unit": "kg", "unit_cost": 1},  # neither existing nor create_new -> skipped
        ]}, timeout=20)
        assert r.status_code == 201, r.text
        assert r.json() == {"ok": True, "created": 1, "received": 2}
        e = get_ing(H, ing["id"])
        assert e["cost_per_unit"] == 1.2 and abs(e["quantity"] - 12) < 1e-6
        lst = requests.get(f"{API}/t/ingredients", headers=H, timeout=15).json()
        n = next(i for i in lst if i["name"] == new_name)
        bag["ings"].append(n["id"])
        assert n["category"] == "Latticini" and n["unit"] == "kg" and n["cost_per_unit"] == 8.5 and n["quantity"] == 4
        assert not any(i["name"] == "TEST_skip" for i in lst)
        sups = requests.get(f"{API}/t/suppliers", headers=H, timeout=15).json()
        s = next(x for x in sups if x["name"] == sup)
        bag["sups"].append(s["id"])
        assert n["supplier_id"] == s["id"] and e["supplier_id"] == s["id"]
        movs = requests.get(f"{API}/t/ingredients/{n['id']}/movements", headers=H, timeout=15).json()
        assert movs[0]["type"] == "carico" and movs[0]["delta"] == 4
        # re-apply with same supplier name (different case) must reuse supplier
        requests.post(f"{API}/t/invoices/apply", headers=H, json={"supplier_name": sup.upper(), "lines": [
            {"name": ing["name"], "ingredient_id": ing["id"], "qty": 1}]}, timeout=20)
        assert len([x for x in requests.get(f"{API}/t/suppliers", headers=H, timeout=15).json() if x["name"].lower() == sup.lower()]) == 1

    def test_apply_empty_400(self, H):
        assert requests.post(f"{API}/t/invoices/apply", headers=H, json={"lines": []}, timeout=15).status_code == 400

    def test_apply_supplier_special_chars(self, H, bag):
        ing = mk_ing(H, bag, quantity=0)
        sup = f"TEST_Rossi (srl) [{uuid.uuid4().hex[:4]}"
        r = requests.post(f"{API}/t/invoices/apply", headers=H, json={"supplier_name": sup, "lines": [
            {"name": ing["name"], "ingredient_id": ing["id"], "qty": 1}]}, timeout=20)
        for s in requests.get(f"{API}/t/suppliers", headers=H, timeout=15).json():
            if s["name"].startswith("TEST_Rossi"):
                bag["sups"].append(s["id"])
        assert r.status_code == 201, f"special chars in supplier name -> {r.status_code} {r.text[:200]}"


# Permissions & isolation
class TestPermsIsolation:
    def test_staff_403(self, H, bag):
        email = f"test_staff_ocr_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/t/users", headers=H, json={"name": "TEST Staff", "email": email, "password": "StaffPass1!", "tenant_role": "staff"}, timeout=15)
        assert r.status_code in (200, 201), r.text
        bag["users"].append(r.json().get("id"))
        S = login({"email": email, "password": "StaffPass1!"})
        with open(make("/tmp/inv_staff.jpg"), "rb") as f:
            assert requests.post(f"{API}/t/invoices/scan", headers=S, files={"file": ("f.jpg", f, "image/jpeg")}, timeout=30).status_code == 403
        assert requests.post(f"{API}/t/invoices/apply", headers=S, json={"lines": [{"name": "x", "qty": 1, "create_new": True}]}, timeout=15).status_code == 403
        fc = requests.get(f"{API}/t/food-cost", headers=S, timeout=15)
        print("staff food-cost status:", fc.status_code)
        assert fc.status_code == 403, "food-cost should require manager (review request) but staff gets %s" % fc.status_code

    def test_unauth(self):
        assert requests.get(f"{API}/t/food-cost", timeout=15).status_code == 401
        assert requests.post(f"{API}/t/invoices/apply", json={"lines": []}, timeout=15).status_code == 401

    def test_tenant_isolation(self, H, bag):
        A = login(SUPER)
        sfx = uuid.uuid4().hex[:6]
        r = requests.post(f"{API}/admin/tenants", headers=A, json={"name": f"TEST FC {sfx}", "slug": f"test-fc-{sfx}",
                          "owner_name": "TEST", "owner_email": f"test_fc_{sfx}@example.com", "owner_password": "ValidPass123!",
                          "send_invite": False}, timeout=20)
        assert r.status_code == 201, r.text
        tid = r.json()["id"]
        try:
            O2 = login({"email": f"test_fc_{sfx}@example.com", "password": "ValidPass123!"})
            fc = requests.get(f"{API}/t/food-cost", headers=O2, timeout=15).json()
            demo_ids = {x["item_id"] for x in requests.get(f"{API}/t/food-cost", headers=H, timeout=15).json()["items"]}
            assert not ({x["item_id"] for x in fc["items"]} & demo_ids)
            ing = mk_ing(H, bag, quantity=3, cost_per_unit=2)
            r = requests.post(f"{API}/t/invoices/apply", headers=O2, json={"supplier_name": "TEST_x", "lines": [
                {"name": "hack", "ingredient_id": ing["id"], "qty": 50, "unit_cost": 99}]}, timeout=15)
            assert r.status_code == 201 and r.json()["received"] == 0
            e = get_ing(H, ing["id"])
            assert e["quantity"] == 3 and e["cost_per_unit"] == 2
            assert requests.get(f"{API}/t/ingredients", headers=O2, timeout=15).json() == []
        finally:
            requests.patch(f"{API}/admin/tenants/{tid}", headers=A, json={"active": False}, timeout=15)
