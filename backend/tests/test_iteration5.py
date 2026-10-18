"""Iteration 5: Waiter quick order (POST /t/orders, client_id idempotency) + payment client_id idempotency."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
OWNER = {"email": "owner@trattoria-demo.it", "password": "Demo2026!"}
SUPER = {"email": "fabio.borelli@icloud.com", "password": "RistoOS2026!"}


def login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def H():
    return login(OWNER)


@pytest.fixture(scope="module")
def tables(H):
    r = requests.get(f"{BASE_URL}/api/t/tables", headers=H, timeout=15)
    assert r.status_code == 200
    return {t["name"]: t for t in r.json()}


@pytest.fixture(scope="module")
def items(H):
    r = requests.get(f"{BASE_URL}/api/t/menu/items", headers=H, timeout=15)
    assert r.status_code == 200
    return r.json()


def pick(items, with_variants=False):
    for it in items:
        if it.get("available", True) and (bool(it.get("variants")) == with_variants):
            return it
    pytest.skip("no suitable item")


def free_bill_close(H, bill_id):
    b = requests.get(f"{BASE_URL}/api/t/bills/{bill_id}", headers=H, timeout=15).json()
    if b.get("status") != "aperto":
        return
    if b.get("remaining", 0) > 0:
        requests.post(f"{BASE_URL}/api/t/bills/{bill_id}/payments", headers=H,
                      json={"method": "contanti", "amount": b["remaining"]}, timeout=15)
    requests.post(f"{BASE_URL}/api/t/bills/{bill_id}/close", headers=H, timeout=15)


# Waiter order creation + idempotency
class TestWaiterOrder:
    def test_create_order_and_idempotency(self, H, tables, items):
        t = tables.get("D1") or list(tables.values())[0]
        it = pick(items)
        cid = f"c-TEST-{uuid.uuid4().hex[:8]}"
        body = {"table_id": t["id"], "lines": [{"item_id": it["id"], "qty": 2, "notes": "TEST nota"}],
                "notes": "TEST", "client_id": cid}
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, json=body, timeout=15)
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["source"] == "sala" and o["status"] == "nuovo"
        assert o["table_id"] == t["id"] and o["client_id"] == cid
        assert isinstance(o["stations"], dict) and o["stations"]
        assert all(i.get("station_id") for i in o["items"])
        assert o["items"][0]["qty"] == 2 and o["items"][0]["notes"] == "TEST nota"
        assert abs(o["total"] - 2 * it["price"]) < 0.01
        assert "_id" not in o
        r2 = requests.post(f"{BASE_URL}/api/t/orders", headers=H, json=body, timeout=15)
        assert r2.status_code in (200, 201)
        assert r2.json()["id"] == o["id"]
        lst = requests.get(f"{BASE_URL}/api/t/orders", headers=H, timeout=15).json()
        assert sum(1 for x in lst if x.get("client_id") == cid) == 1
        tb = {x["id"]: x for x in requests.get(f"{BASE_URL}/api/t/tables", headers=H, timeout=15).json()}
        assert tb[t["id"]]["status"] == "occupato"
        requests.patch(f"{BASE_URL}/api/t/orders/{o['id']}/status", headers=H, json={"status": "annullato"}, timeout=15)

    def test_variant_ok(self, H, tables, items):
        t = tables.get("D1") or list(tables.values())[0]
        it = pick(items, True)
        v = it["variants"][0]
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, timeout=15,
                          json={"table_id": t["id"], "lines": [{"item_id": it["id"], "qty": 1, "variant": v["name"]}]})
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["items"][0]["variant"] == v["name"]
        assert abs(o["items"][0]["price"] - (it["price"] + v["price_delta"])) < 0.01
        requests.patch(f"{BASE_URL}/api/t/orders/{o['id']}/status", headers=H, json={"status": "annullato"}, timeout=15)

    def test_empty_lines_400(self, H, tables):
        t = tables.get("D1") or list(tables.values())[0]
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, json={"table_id": t["id"], "lines": []}, timeout=15)
        assert r.status_code == 400

    def test_invalid_item_400(self, H, tables):
        t = tables.get("D1") or list(tables.values())[0]
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, timeout=15,
                          json={"table_id": t["id"], "lines": [{"item_id": "nope", "qty": 1}]})
        assert r.status_code == 400

    def test_invalid_qty_400(self, H, tables, items):
        t = tables.get("D1") or list(tables.values())[0]
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, timeout=15,
                          json={"table_id": t["id"], "lines": [{"item_id": pick(items)["id"], "qty": 0}]})
        assert r.status_code == 400

    def test_invalid_variant_400(self, H, tables, items):
        t = tables.get("D1") or list(tables.values())[0]
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, timeout=15,
                          json={"table_id": t["id"], "lines": [{"item_id": pick(items, True)["id"], "qty": 1, "variant": "XXX"}]})
        assert r.status_code == 400

    def test_unknown_table_404(self, H, items):
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, timeout=15,
                          json={"table_id": "not-a-table", "lines": [{"item_id": pick(items)["id"], "qty": 1}]})
        assert r.status_code == 404

    def test_other_tenant_table_404(self, H, items):
        S = login(SUPER)
        tenants = requests.get(f"{BASE_URL}/api/admin/tenants", headers=S, timeout=15).json()
        tlist = tenants if isinstance(tenants, list) else tenants.get("tenants", [])
        others = [x for x in tlist if x.get("slug") != "trattoria-demo"]
        for other in others:
            ts = requests.get(f"{BASE_URL}/api/t/tables", headers={**S, "X-Tenant-Id": other["id"]}, timeout=15)
            if ts.status_code == 200 and ts.json():
                r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, timeout=15,
                                  json={"table_id": ts.json()[0]["id"], "lines": [{"item_id": pick(items)["id"], "qty": 1}]})
                assert r.status_code == 404
                return
        if not others:
            pytest.skip("no other tenant")
        SH = {**S, "X-Tenant-Id": others[0]["id"]}
        room = requests.post(f"{BASE_URL}/api/t/rooms", headers=SH, json={"name": "TEST room"}, timeout=15)
        assert room.status_code == 201, room.text
        tb = requests.post(f"{BASE_URL}/api/t/tables", headers=SH, json={"room_id": room.json()["id"], "name": "TEST X"}, timeout=15)
        assert tb.status_code == 201, tb.text
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, timeout=15,
                          json={"table_id": tb.json()["id"], "lines": [{"item_id": pick(items)["id"], "qty": 1}]})
        assert r.status_code == 404

    def test_staff_allowed(self, H, tables, items):
        email = f"test_staff_{uuid.uuid4().hex[:6]}@example.com"
        cu = requests.post(f"{BASE_URL}/api/t/users", headers=H, timeout=15,
                           json={"name": "TEST Staff", "email": email, "password": "Staff2026!", "tenant_role": "staff"})
        assert cu.status_code == 201, cu.text
        try:
            SH = login({"email": email, "password": "Staff2026!"})
            t = tables.get("D2") or list(tables.values())[0]
            r = requests.post(f"{BASE_URL}/api/t/orders", headers=SH, timeout=15,
                              json={"table_id": t["id"], "lines": [{"item_id": pick(items)["id"], "qty": 1}]})
            assert r.status_code == 201, r.text
            assert r.json()["customer_name"] == "TEST Staff"
            requests.patch(f"{BASE_URL}/api/t/orders/{r.json()['id']}/status", headers=H, json={"status": "annullato"}, timeout=15)
        finally:
            requests.delete(f"{BASE_URL}/api/t/users/{cu.json()['id']}", headers=H, timeout=15)

    def test_order_attaches_to_open_bill(self, H, tables, items):
        t = tables.get("D3") or list(tables.values())[0]
        b = requests.post(f"{BASE_URL}/api/t/bills/open", headers=H, json={"table_id": t["id"]}, timeout=15)
        assert b.status_code in (200, 201), b.text
        bill = b.json()
        it = pick(items)
        r = requests.post(f"{BASE_URL}/api/t/orders", headers=H, timeout=15,
                          json={"table_id": t["id"], "lines": [{"item_id": it["id"], "qty": 1}]})
        assert r.status_code == 201
        o = r.json()
        assert o["bill_id"] == bill["id"]
        bb = requests.get(f"{BASE_URL}/api/t/bills/{bill['id']}", headers=H, timeout=15).json()
        assert any(l.get("order_id") == o["id"] and l["item_id"] == it["id"] for l in bb["lines"])
        # Payment idempotency with client_id
        cid = f"c-TEST-pay-{uuid.uuid4().hex[:6]}"
        p1 = requests.post(f"{BASE_URL}/api/t/bills/{bill['id']}/payments", headers=H, timeout=15,
                           json={"method": "contanti", "amount": 1.0, "client_id": cid})
        assert p1.status_code == 200, p1.text
        paid1 = p1.json()["paid"]
        p2 = requests.post(f"{BASE_URL}/api/t/bills/{bill['id']}/payments", headers=H, timeout=15,
                           json={"method": "contanti", "amount": 1.0, "client_id": cid})
        assert p2.status_code == 200, p2.text
        assert p2.json().get("paid") == paid1, p2.json()
        bb = requests.get(f"{BASE_URL}/api/t/bills/{bill['id']}", headers=H, timeout=15).json()
        assert sum(1 for pm in bb["payments"] if pm.get("client_id") == cid) == 1
        free_bill_close(H, bill["id"])
        assert requests.get(f"{BASE_URL}/api/t/bills/{bill['id']}", headers=H, timeout=15).json()["status"] == "chiuso"
