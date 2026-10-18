"""Iteration 6: Magazzino (inventory) - suppliers, ingredients, stats, movements, receive, count,
recipes, food cost, auto-depletion from waiter/QR orders, multi-tenant isolation, permissions."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
OWNER = {"email": "owner@trattoria-demo.it", "password": "Demo2026!"}
SUPER = {"email": "fabio.borelli@icloud.com", "password": "RistoOS2026!"}
SLUG = "trattoria-demo"


def login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def H():
    return login(OWNER)


@pytest.fixture(scope="module")
def created(H):
    bag = {"ings": [], "sups": []}
    yield bag
    for i in bag["ings"]:
        requests.delete(f"{API}/t/ingredients/{i}", headers=H, timeout=15)
    for s in bag["sups"]:
        requests.delete(f"{API}/t/suppliers/{s}", headers=H, timeout=15)


def mk_ing(H, created, **kw):
    body = {"name": f"TEST_ing_{uuid.uuid4().hex[:6]}", "category": "Verdura", "unit": "kg",
            "cost_per_unit": 2.5, "quantity": 10, "min_stock": 3, "par_stock": 8}
    body.update(kw)
    r = requests.post(f"{API}/t/ingredients", headers=H, json=body, timeout=15)
    assert r.status_code == 201, r.text
    created["ings"].append(r.json()["id"])
    return r.json()


def get_ing(H, iid):
    lst = requests.get(f"{API}/t/ingredients", headers=H, timeout=15).json()
    return next((i for i in lst if i["id"] == iid), None)


# Meta: categories & units
class TestMeta:
    def test_categories_units(self, H):
        c = requests.get(f"{API}/t/inventory/categories", headers=H, timeout=15)
        assert c.status_code == 200 and len(c.json()) == 20 and "Carne" in c.json()
        u = requests.get(f"{API}/t/inventory/units", headers=H, timeout=15).json()
        assert set(u) == {"pz", "kg", "g", "l", "ml", "bt", "cf", "cl"}


# Suppliers CRUD
class TestSuppliers:
    def test_supplier_crud(self, H, created):
        r = requests.post(f"{API}/t/suppliers", headers=H, json={"name": "TEST_Sup A", "phone": "123", "email": "a@x.it"}, timeout=15)
        assert r.status_code == 201
        s = r.json(); assert s["name"] == "TEST_Sup A" and "_id" not in s
        lst = requests.get(f"{API}/t/suppliers", headers=H, timeout=15).json()
        assert any(x["id"] == s["id"] for x in lst)
        r = requests.patch(f"{API}/t/suppliers/{s['id']}", headers=H, json={"name": "TEST_Sup B", "phone": "999"}, timeout=15)
        assert r.status_code == 200 and r.json()["name"] == "TEST_Sup B" and r.json()["phone"] == "999"
        r = requests.delete(f"{API}/t/suppliers/{s['id']}", headers=H, timeout=15)
        assert r.status_code == 200
        lst = requests.get(f"{API}/t/suppliers", headers=H, timeout=15).json()
        assert not any(x["id"] == s["id"] for x in lst)
        assert requests.delete(f"{API}/t/suppliers/{s['id']}", headers=H, timeout=15).status_code == 404


# Ingredient creation + stats
class TestIngredients:
    def test_create_with_supplier_and_initial_stock(self, H, created):
        s = requests.post(f"{API}/t/suppliers", headers=H, json={"name": "TEST_Sup Ing"}, timeout=15).json()
        created["sups"].append(s["id"])
        ing = mk_ing(H, created, supplier_id=s["id"], barcode="TEST8001234", category="Latticini", unit="l")
        assert ing["quantity"] == 10 and ing["supplier_name"] == "TEST_Sup Ing"
        assert ing["category"] == "Latticini" and ing["unit"] == "l" and ing["min_stock"] == 3 and ing["par_stock"] == 8
        movs = requests.get(f"{API}/t/ingredients/{ing['id']}/movements", headers=H, timeout=15).json()
        assert len(movs) == 1 and movs[0]["type"] == "carico" and movs[0]["delta"] == 10
        got = get_ing(H, ing["id"])
        assert got and got["quantity"] == 10

    def test_patch_ingredient(self, H, created):
        ing = mk_ing(H, created)
        r = requests.patch(f"{API}/t/ingredients/{ing['id']}", headers=H, json={"cost_per_unit": 4.0, "min_stock": 5}, timeout=15)
        assert r.status_code == 200 and r.json()["cost_per_unit"] == 4.0 and r.json()["min_stock"] == 5
        assert r.json()["quantity"] == 10

    def test_stats_reflect_values(self, H, created):
        before = requests.get(f"{API}/t/ingredients/stats", headers=H, timeout=15).json()
        # below min -> low + reorder; value = 1*2 = 2 ; reorder value = (8-1)*2 = 14
        mk_ing(H, created, quantity=1, min_stock=3, par_stock=8, cost_per_unit=2)
        # exactly at min -> low but not reorder
        mk_ing(H, created, quantity=3, min_stock=3, par_stock=8, cost_per_unit=1)
        after = requests.get(f"{API}/t/ingredients/stats", headers=H, timeout=15).json()
        assert after["total"] == before["total"] + 2
        assert after["low_count"] == before["low_count"] + 2
        assert after["reorder_count"] == before["reorder_count"] + 1
        assert abs(after["reorder_value"] - before["reorder_value"] - 14) < 0.01
        assert abs(after["stock_value"] - before["stock_value"] - 5) < 0.01

    def test_filters_and_search(self, H, created):
        tag = uuid.uuid4().hex[:6]
        low = mk_ing(H, created, name=f"TEST_low_{tag}", quantity=1, min_stock=3, category="Pesce")
        edge = mk_ing(H, created, name=f"TEST_edge_{tag}", quantity=3, min_stock=3, category="Pesce")
        nip = mk_ing(H, created, name=f"TEST_nip_{tag}", not_in_pos=True, barcode=f"BC{tag}")
        g = lambda **p: [i["id"] for i in requests.get(f"{API}/t/ingredients", headers=H, params=p, timeout=15).json()]
        assert low["id"] in g(filter="low") and edge["id"] in g(filter="low")
        assert low["id"] in g(filter="reorder") and edge["id"] not in g(filter="reorder")
        assert nip["id"] in g(filter="not_in_pos") and low["id"] not in g(filter="not_in_pos")
        assert set(g(q=tag)) == {low["id"], edge["id"], nip["id"]}
        assert g(q=f"BC{tag}") == [nip["id"]]
        pesce = g(category="Pesce", q=tag)
        assert set(pesce) == {low["id"], edge["id"]}


# Manual movements
class TestMovements:
    def test_all_movement_types(self, H, created):
        ing = mk_ing(H, created, quantity=10)
        url = f"{API}/t/ingredients/{ing['id']}/movement"
        seq = [("carico", 5, 15), ("scarico", 2, 13), ("spreco", 1, 12), ("reso", 3, 15), ("rettifica", 7, 7), ("scarico", -2, 5)]
        for t, q, exp in seq:
            r = requests.post(url, headers=H, json={"type": t, "qty": q, "note": "TEST"}, timeout=15)
            assert r.status_code == 200, r.text
            assert abs(r.json()["quantity"] - exp) < 1e-6, (t, r.json()["quantity"], exp)
        movs = requests.get(f"{API}/t/ingredients/{ing['id']}/movements", headers=H, timeout=15).json()
        assert len(movs) == 7
        assert [m["type"] for m in movs][:1] == ["scarico"]
        assert get_ing(H, ing["id"])["quantity"] == 5

    def test_invalid_movement_type(self, H, created):
        ing = mk_ing(H, created)
        r = requests.post(f"{API}/t/ingredients/{ing['id']}/movement", headers=H, json={"type": "vendita", "qty": 1}, timeout=15)
        assert r.status_code == 400

    def test_waste_stat(self, H, created):
        before = requests.get(f"{API}/t/ingredients/stats", headers=H, timeout=15).json()["waste_30d"]
        ing = mk_ing(H, created, cost_per_unit=3, quantity=10)
        requests.post(f"{API}/t/ingredients/{ing['id']}/movement", headers=H, json={"type": "spreco", "qty": 2}, timeout=15)
        after = requests.get(f"{API}/t/ingredients/stats", headers=H, timeout=15).json()["waste_30d"]
        assert abs(after - before - 6) < 0.01


# Receive & count
class TestReceiveCount:
    def test_receive_multi_and_cost_update(self, H, created):
        a = mk_ing(H, created, quantity=1, cost_per_unit=2)
        b = mk_ing(H, created, quantity=0)
        r = requests.post(f"{API}/t/inventory/receive", headers=H, json={"note": "TEST", "lines": [
            {"ingredient_id": a["id"], "qty": 4, "cost_per_unit": 2.8},
            {"ingredient_id": b["id"], "qty": 6},
            {"ingredient_id": "nonexistent", "qty": 3}]}, timeout=15)
        assert r.status_code == 201 and r.json()["received"] == 2
        ga, gb = get_ing(H, a["id"]), get_ing(H, b["id"])
        assert ga["quantity"] == 5 and ga["cost_per_unit"] == 2.8
        assert gb["quantity"] == 6

    def test_receive_empty_400(self, H):
        assert requests.post(f"{API}/t/inventory/receive", headers=H, json={"lines": []}, timeout=15).status_code == 400

    def test_count_session(self, H, created):
        a = mk_ing(H, created, quantity=10)
        b = mk_ing(H, created, quantity=4)
        r = requests.post(f"{API}/t/inventory/count", headers=H, json={"note": "TEST", "lines": [
            {"ingredient_id": a["id"], "counted_qty": 7.5}, {"ingredient_id": b["id"], "counted_qty": 4}]}, timeout=15)
        assert r.status_code == 201 and r.json()["adjusted"] == 1 and r.json()["items"] == 2
        assert get_ing(H, a["id"])["quantity"] == 7.5 and get_ing(H, b["id"])["quantity"] == 4
        st = requests.get(f"{API}/t/ingredients/stats", headers=H, timeout=15).json()
        assert st["last_count"] == r.json()["created_at"]


# Recipes, food cost and auto-depletion
class TestRecipeDepletion:
    def _item(self, H):
        items = requests.get(f"{API}/t/menu/items", headers=H, timeout=15).json()
        it = next((i for i in items if i.get("available", True) and not i.get("variants")), None)
        if not it:
            pytest.skip("no item")
        return it

    def test_recipe_foodcost_and_waiter_depletion(self, H, created):
        it = self._item(H)
        old = requests.get(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, timeout=15).json()["lines"]
        ing = mk_ing(H, created, quantity=8, cost_per_unit=5)
        try:
            r = requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H,
                             json={"lines": [{"ingredient_id": ing["id"], "qty": 0.3}]}, timeout=15)
            assert r.status_code == 200 and r.json()["lines"] == [{"ingredient_id": ing["id"], "qty": 0.3}]
            fc = requests.get(f"{API}/t/menu/items/{it['id']}/food-cost", headers=H, timeout=15).json()
            assert abs(fc["cost"] - 1.5) < 0.01 and fc["price"] == it["price"]
            tables = requests.get(f"{API}/t/tables", headers=H, timeout=15).json()
            t = next((x for x in tables if x["name"] == "D1"), tables[0])
            o = requests.post(f"{API}/t/orders", headers=H, json={"table_id": t["id"], "lines": [{"item_id": it["id"], "qty": 2}],
                                                                   "client_id": f"c-TEST-{uuid.uuid4().hex[:8]}"}, timeout=15)
            assert o.status_code == 201
            assert abs(get_ing(H, ing["id"])["quantity"] - 7.4) < 1e-6
            movs = requests.get(f"{API}/t/ingredients/{ing['id']}/movements", headers=H, timeout=15).json()
            assert movs[0]["type"] == "vendita" and movs[0]["order_id"] == o.json()["id"]
            requests.patch(f"{API}/t/orders/{o.json()['id']}/status", headers=H, json={"status": "annullato"}, timeout=15)

            # QR public order
            tq = next((x for x in tables if x.get("code") == "DEMO06"), tables[0])
            q = requests.post(f"{API}/public/{SLUG}/orders", json={"table_code": tq["code"], "customer_name": "TEST_inv",
                                                                   "lines": [{"item_id": it["id"], "qty": 3}]}, timeout=15)
            assert q.status_code == 201, q.text
            assert abs(get_ing(H, ing["id"])["quantity"] - 6.5) < 1e-6
            requests.patch(f"{API}/t/orders/{q.json()['id']}/status", headers=H, json={"status": "annullato"}, timeout=15)
        finally:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, json={"lines": old}, timeout=15)

    def test_order_without_recipe_not_blocked(self, H):
        items = requests.get(f"{API}/t/menu/items", headers=H, timeout=15).json()
        tables = requests.get(f"{API}/t/tables", headers=H, timeout=15).json()
        it = None
        for i in items:
            if i.get("variants"):
                continue
            if not requests.get(f"{API}/t/menu/items/{i['id']}/recipe", headers=H, timeout=15).json()["lines"]:
                it = i; break
        if not it:
            pytest.skip("all have recipes")
        t = next((x for x in tables if x["name"] == "D2"), tables[0])
        o = requests.post(f"{API}/t/orders", headers=H, json={"table_id": t["id"], "lines": [{"item_id": it["id"], "qty": 1}]}, timeout=15)
        assert o.status_code == 201
        requests.patch(f"{API}/t/orders/{o.json()['id']}/status", headers=H, json={"status": "annullato"}, timeout=15)

    def test_delete_ingredient_pulls_from_recipe(self, H, created):
        it = self._item(H)
        old = requests.get(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, timeout=15).json()["lines"]
        ing = mk_ing(H, created)
        try:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H,
                         json={"lines": old + [{"ingredient_id": ing["id"], "qty": 1}]}, timeout=15)
            assert requests.delete(f"{API}/t/ingredients/{ing['id']}", headers=H, timeout=15).status_code == 200
            lines = requests.get(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, timeout=15).json()["lines"]
            assert all(l["ingredient_id"] != ing["id"] for l in lines)
        finally:
            requests.put(f"{API}/t/menu/items/{it['id']}/recipe", headers=H, json={"lines": old}, timeout=15)


# Permissions & tenant isolation
class TestPermsIsolation:
    def test_staff_permissions(self, H, created):
        email = f"test_staff_inv_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/t/users", headers=H, json={"name": "TEST Staff", "email": email, "password": "StaffPass1!", "tenant_role": "staff"}, timeout=15)
        assert r.status_code in (200, 201), r.text
        S = login({"email": email, "password": "StaffPass1!"})
        assert requests.get(f"{API}/t/ingredients", headers=S, timeout=15).status_code == 200
        assert requests.post(f"{API}/t/ingredients", headers=S, json={"name": "TEST_x"}, timeout=15).status_code == 403
        assert requests.post(f"{API}/t/suppliers", headers=S, json={"name": "TEST_x"}, timeout=15).status_code == 403
        ing = mk_ing(H, created, quantity=5)
        assert requests.patch(f"{API}/t/ingredients/{ing['id']}", headers=S, json={"name": "x"}, timeout=15).status_code == 403
        assert requests.delete(f"{API}/t/ingredients/{ing['id']}", headers=S, timeout=15).status_code == 403
        assert requests.post(f"{API}/t/inventory/receive", headers=S, json={"lines": [{"ingredient_id": ing["id"], "qty": 1}]}, timeout=15).status_code == 403
        r = requests.post(f"{API}/t/ingredients/{ing['id']}/movement", headers=S, json={"type": "spreco", "qty": 1}, timeout=15)
        assert r.status_code == 200 and r.json()["quantity"] == 4
        uid = r and [u for u in requests.get(f"{API}/t/users", headers=H, timeout=15).json() if u.get("email") == email]
        if uid:
            requests.delete(f"{API}/t/users/{uid[0]['id']}", headers=H, timeout=15)

    def test_tenant_isolation(self, H, created):
        A = login(SUPER)
        sfx = uuid.uuid4().hex[:6]
        r = requests.post(f"{API}/admin/tenants", headers=A, json={"name": f"TEST Inv {sfx}", "slug": f"test-inv-{sfx}",
                          "owner_name": "TEST", "owner_email": f"test_inv_{sfx}@example.com", "owner_password": "ValidPass123!",
                          "send_invite": False}, timeout=20)
        assert r.status_code == 201, r.text
        tid = r.json()["id"]
        try:
            O2 = login({"email": f"test_inv_{sfx}@example.com", "password": "ValidPass123!"})
            ing = mk_ing(H, created)
            assert requests.get(f"{API}/t/ingredients", headers=O2, timeout=15).json() == []
            assert requests.get(f"{API}/t/suppliers", headers=O2, timeout=15).json() == []
            assert requests.post(f"{API}/t/ingredients/{ing['id']}/movement", headers=O2, json={"type": "scarico", "qty": 1}, timeout=15).status_code == 404
            assert requests.patch(f"{API}/t/ingredients/{ing['id']}", headers=O2, json={"name": "hack"}, timeout=15).status_code == 404
            r = requests.post(f"{API}/t/inventory/receive", headers=O2, json={"lines": [{"ingredient_id": ing["id"], "qty": 5}]}, timeout=15)
            assert r.json().get("received") == 0
            assert get_ing(H, ing["id"])["quantity"] == 10
        finally:
            requests.patch(f"{API}/admin/tenants/{tid}", headers=A, json={"active": False}, timeout=15)
