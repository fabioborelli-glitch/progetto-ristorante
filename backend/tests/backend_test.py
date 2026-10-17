"""RistoOS backend regression tests.

Covers: auth (login/me/wrong password/lockout), super-admin tenants CRUD,
tenant settings/rooms/tables/reservations/menu/orders/dashboard, public
booking + QR menu + order flow, authorization matrix across tenants.
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://ristoos.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "fabio.borelli@icloud.com"
ADMIN_PASS = "RistoOS2026!"
OWNER_EMAIL = "owner@trattoria-demo.it"
OWNER_PASS = "Demo2026!"
DEMO_SLUG = "trattoria-demo"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    return r


@pytest.fixture(scope="session")
def admin_token():
    r = _login(ADMIN_EMAIL, ADMIN_PASS)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def owner_token():
    r = _login(OWNER_EMAIL, OWNER_PASS)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def owner_access(owner_token):
    return owner_token["access_token"]


@pytest.fixture(scope="session")
def demo_tenant_id(owner_token):
    return owner_token["tenant_id"]


def H(token, tenant=None):
    h = {"Authorization": f"Bearer {token}"}
    if tenant:
        h["X-Tenant-Id"] = tenant
    return h


# ---------- Auth ----------
class TestAuth:
    def test_login_ok_returns_access_token_and_user(self):
        r = _login(ADMIN_EMAIL, ADMIN_PASS)
        assert r.status_code == 200
        d = r.json()
        assert "access_token" in d and isinstance(d["access_token"], str)
        assert d["email"] == ADMIN_EMAIL
        assert d["platform_role"] == "superadmin"
        # httpOnly cookie set
        assert "access_token" in r.cookies.get_dict() or any(
            c.lower().startswith("access_token=") for c in r.headers.get("set-cookie", "").split(",")
        )

    def test_login_wrong_password_401_italian(self):
        r = _login(ADMIN_EMAIL, "WrongPass123!")
        assert r.status_code == 401
        assert "non corrett" in r.json()["detail"].lower()

    def test_me_with_bearer(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=H(admin_token))
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_tenant_endpoint_unauth(self):
        r = requests.get(f"{API}/t/settings")
        assert r.status_code == 401

    def test_lockout_after_5_fails(self):
        # Use a fresh email to avoid impacting real accounts
        bad_email = f"locktest+{uuid.uuid4().hex[:6]}@example.com"
        statuses = []
        for _ in range(6):
            r = _login(bad_email, "whatever")
            statuses.append(r.status_code)
        # First 5 should be 401, 6th should be 429
        assert statuses[:5] == [401] * 5, f"got {statuses}"
        assert statuses[5] == 429, f"expected lockout, got {statuses}"


# ---------- Super-admin ----------
class TestSuperAdmin:
    def test_list_tenants(self, admin_token):
        r = requests.get(f"{API}/admin/tenants", headers=H(admin_token))
        assert r.status_code == 200
        tenants = r.json()
        assert any(t["slug"] == DEMO_SLUG for t in tenants)

    def test_non_admin_forbidden(self, owner_access):
        r = requests.get(f"{API}/admin/tenants", headers=H(owner_access))
        assert r.status_code == 403

    def test_create_tenant_and_impersonate(self, admin_token):
        suffix = uuid.uuid4().hex[:6]
        payload = {
            "name": f"TEST Osteria {suffix}",
            "slug": f"test-osteria-{suffix}",
            "city": "Roma",
            "owner_name": "TEST Owner",
            "owner_email": f"TEST_owner_{suffix}@example.com",
            "owner_password": "TestPass123!",
        }
        r = requests.post(f"{API}/admin/tenants", json=payload, headers=H(admin_token))
        assert r.status_code == 201, r.text
        tenant = r.json()
        tid = tenant["id"]
        assert tenant["slug"] == payload["slug"]

        # superadmin via X-Tenant-Id can access tenant data
        r2 = requests.get(f"{API}/t/settings", headers=H(admin_token, tid))
        assert r2.status_code == 200
        assert r2.json()["id"] == tid

        # new owner can log in
        r3 = _login(payload["owner_email"], payload["owner_password"])
        assert r3.status_code == 200
        assert r3.json()["tenant_id"] == tid

        # cleanup via deactivation (no delete endpoint): mark inactive
        requests.patch(f"{API}/admin/tenants/{tid}", json={"active": False}, headers=H(admin_token))

    def test_create_tenant_duplicate_slug(self, admin_token):
        r = requests.post(f"{API}/admin/tenants", json={
            "name": "Dup", "slug": DEMO_SLUG, "owner_name": "x",
            "owner_email": f"dup_{uuid.uuid4().hex[:6]}@example.com", "owner_password": "TestPass123!"
        }, headers=H(admin_token))
        assert r.status_code == 400


# ---------- Tenant APIs ----------
class TestTenant:
    def test_dashboard(self, owner_access):
        r = requests.get(f"{API}/t/dashboard", headers=H(owner_access))
        assert r.status_code == 200
        d = r.json()
        for k in ("reservations_today", "covers_today", "open_orders", "revenue_today", "tables", "upcoming"):
            assert k in d

    def test_rooms_and_tables(self, owner_access):
        r = requests.get(f"{API}/t/rooms", headers=H(owner_access))
        assert r.status_code == 200 and len(r.json()) >= 2
        r = requests.get(f"{API}/t/tables", headers=H(owner_access))
        assert r.status_code == 200
        tables = r.json()
        assert any(t["code"] == "DEMO01" for t in tables)

    def test_table_status_transition(self, owner_access):
        r = requests.get(f"{API}/t/tables", headers=H(owner_access))
        tid = next(t["id"] for t in r.json() if t["code"] == "DEMO02")
        r = requests.patch(f"{API}/t/tables/{tid}", json={"status": "occupato"}, headers=H(owner_access))
        assert r.status_code == 200 and r.json()["status"] == "occupato"
        # verify persistence
        r = requests.get(f"{API}/t/tables", headers=H(owner_access))
        assert next(t for t in r.json() if t["id"] == tid)["status"] == "occupato"
        # reset
        requests.patch(f"{API}/t/tables/{tid}", json={"status": "libero"}, headers=H(owner_access))

    def test_table_positions_persist(self, owner_access):
        r = requests.get(f"{API}/t/tables", headers=H(owner_access))
        t = next(t for t in r.json() if t["code"] == "DEMO03")
        new_x, new_y = 333.0, 222.0
        r = requests.put(f"{API}/t/tables/positions",
                         json=[{"id": t["id"], "x": new_x, "y": new_y}],
                         headers=H(owner_access))
        assert r.status_code == 200
        r = requests.get(f"{API}/t/tables", headers=H(owner_access))
        after = next(x for x in r.json() if x["id"] == t["id"])
        assert after["x"] == new_x and after["y"] == new_y

    def test_reservation_crud(self, owner_access):
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        payload = {"date": today, "time": "20:00", "guests": 2, "name": "TEST_Guest",
                   "phone": "+39 000", "status": "confermata"}
        r = requests.post(f"{API}/t/reservations", json=payload, headers=H(owner_access))
        assert r.status_code == 201, r.text
        rid = r.json()["id"]
        # GET verifies persistence
        r = requests.get(f"{API}/t/reservations?date={today}", headers=H(owner_access))
        assert any(x["id"] == rid for x in r.json())
        # delete (manager+)
        r = requests.delete(f"{API}/t/reservations/{rid}", headers=H(owner_access))
        assert r.status_code == 200

    def test_menu_items_and_allergens(self, owner_access):
        r = requests.get(f"{API}/t/menu/allergens", headers=H(owner_access))
        assert r.status_code == 200 and "glutine" in r.json()
        r = requests.get(f"{API}/t/menu/categories", headers=H(owner_access))
        assert r.status_code == 200
        cats = r.json()
        assert len(cats) >= 5
        cid = cats[0]["id"]
        r = requests.post(f"{API}/t/menu/items", json={
            "category_id": cid, "name": "TEST_Dish", "price": 9.9, "allergens": ["glutine"]
        }, headers=H(owner_access))
        assert r.status_code == 201
        iid = r.json()["id"]
        # toggle availability
        r = requests.patch(f"{API}/t/menu/items/{iid}", json={"available": False}, headers=H(owner_access))
        assert r.status_code == 200 and r.json()["available"] is False
        # delete
        r = requests.delete(f"{API}/t/menu/items/{iid}", headers=H(owner_access))
        assert r.status_code == 200


# ---------- Public ----------
class TestPublic:
    def test_public_info(self):
        r = requests.get(f"{API}/public/{DEMO_SLUG}")
        assert r.status_code == 200
        assert r.json()["slug"] == DEMO_SLUG

    def test_public_availability(self):
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.get(f"{API}/public/{DEMO_SLUG}/availability", params={"date": today, "guests": 2})
        assert r.status_code == 200
        slots = r.json()
        assert any(s["time"] == "20:00" for s in slots)

    def test_public_reservation_creates_in_attesa_online(self, owner_access):
        from datetime import datetime, timezone, timedelta
        d = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        r = requests.post(f"{API}/public/{DEMO_SLUG}/reservations", json={
            "date": d, "time": "20:00", "guests": 2, "name": "TEST_Public", "phone": "+39 1"})
        assert r.status_code == 201, r.text
        rid = r.json()["id"]
        assert r.json()["status"] == "in_attesa"
        assert r.json()["source"] == "online"
        # Owner can see it
        r2 = requests.get(f"{API}/t/reservations?date={d}", headers=H(owner_access))
        assert any(x["id"] == rid for x in r2.json())

    def test_public_capacity_enforced(self):
        from datetime import datetime, timezone, timedelta
        d = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d")
        # Fill capacity of 40 at a slot
        r = requests.post(f"{API}/public/{DEMO_SLUG}/reservations", json={
            "date": d, "time": "21:00", "guests": 20, "name": "TEST_A", "phone": "1"})
        assert r.status_code == 201
        r = requests.post(f"{API}/public/{DEMO_SLUG}/reservations", json={
            "date": d, "time": "21:00", "guests": 20, "name": "TEST_B", "phone": "2"})
        assert r.status_code == 201
        r = requests.post(f"{API}/public/{DEMO_SLUG}/reservations", json={
            "date": d, "time": "21:00", "guests": 2, "name": "TEST_C", "phone": "3"})
        assert r.status_code == 400

    def test_public_menu_with_table(self):
        r = requests.get(f"{API}/public/{DEMO_SLUG}/menu", params={"table": "DEMO01"})
        assert r.status_code == 200
        d = r.json()
        assert d["table"]["code"] == "DEMO01"
        assert len(d["items"]) > 0

    def test_public_menu_invalid_table(self):
        r = requests.get(f"{API}/public/{DEMO_SLUG}/menu", params={"table": "BADCODE"})
        assert r.status_code == 404

    def test_public_order_flow(self, owner_access):
        menu = requests.get(f"{API}/public/{DEMO_SLUG}/menu", params={"table": "DEMO04"}).json()
        item = menu["items"][0]
        r = requests.post(f"{API}/public/{DEMO_SLUG}/orders", json={
            "table_code": "DEMO04", "customer_name": "TEST", "lines": [{"item_id": item["id"], "qty": 2}]
        })
        assert r.status_code == 201, r.text
        order = r.json()
        oid = order["id"]
        assert order["status"] == "nuovo"
        assert order["total"] == round(item["price"] * 2, 2)
        # status page
        r = requests.get(f"{API}/public/{DEMO_SLUG}/orders/{oid}")
        assert r.status_code == 200
        # Owner lists active orders — includes this
        r = requests.get(f"{API}/t/orders?active=true", headers=H(owner_access))
        assert any(o["id"] == oid for o in r.json())
        # Table becomes occupato
        tables = requests.get(f"{API}/t/tables", headers=H(owner_access)).json()
        assert next(t for t in tables if t["code"] == "DEMO04")["status"] == "occupato"
        # KDS bump through states
        for st in ["in_preparazione", "pronto", "servito"]:
            r = requests.patch(f"{API}/t/orders/{oid}/status", json={"status": st}, headers=H(owner_access))
            assert r.status_code == 200 and r.json()["status"] == st
        # After servito table -> in_attesa_conto
        tables = requests.get(f"{API}/t/tables", headers=H(owner_access)).json()
        assert next(t for t in tables if t["code"] == "DEMO04")["status"] == "in_attesa_conto"
        # Reset
        tid = next(t["id"] for t in tables if t["code"] == "DEMO04")
        requests.patch(f"{API}/t/tables/{tid}", json={"status": "libero"}, headers=H(owner_access))

    def test_public_order_invalid_table(self):
        r = requests.post(f"{API}/public/{DEMO_SLUG}/orders", json={
            "table_code": "BADX", "lines": [{"item_id": "x", "qty": 1}]})
        assert r.status_code == 404

    def test_public_order_empty_cart(self):
        r = requests.post(f"{API}/public/{DEMO_SLUG}/orders", json={
            "table_code": "DEMO01", "lines": []})
        assert r.status_code == 400


# ---------- Authorization matrix ----------
class TestAuthorization:
    @pytest.fixture(scope="class")
    def second_tenant(self, admin_token):
        suffix = uuid.uuid4().hex[:6]
        payload = {
            "name": f"TEST Second {suffix}",
            "slug": f"test-second-{suffix}",
            "owner_name": "TEST B",
            "owner_email": f"TEST_b_{suffix}@example.com",
            "owner_password": "TestPass123!",
        }
        r = requests.post(f"{API}/admin/tenants", json=payload, headers=H(admin_token))
        assert r.status_code == 201
        tenant = r.json()
        login = _login(payload["owner_email"], payload["owner_password"]).json()
        yield {"id": tenant["id"], "owner_token": login["access_token"]}
        requests.patch(f"{API}/admin/tenants/{tenant['id']}", json={"active": False}, headers=H(admin_token))

    def test_cross_tenant_table_404(self, owner_access, second_tenant):
        # Get table from demo tenant then try to patch using 2nd tenant's token
        demo_tables = requests.get(f"{API}/t/tables", headers=H(owner_access)).json()
        tid = demo_tables[0]["id"]
        r = requests.patch(f"{API}/t/tables/{tid}", json={"status": "libero"},
                           headers=H(second_tenant["owner_token"]))
        assert r.status_code == 404

    def test_staff_cannot_create_table(self, admin_token, owner_access):
        # Create a staff user via tenant admin API
        suffix = uuid.uuid4().hex[:6]
        email = f"TEST_staff_{suffix}@example.com"
        r = requests.post(f"{API}/t/users", json={
            "name": "TEST Staff", "email": email, "password": "StaffPass1!", "tenant_role": "staff"
        }, headers=H(owner_access))
        assert r.status_code == 201
        staff_tok = _login(email, "StaffPass1!").json()["access_token"]
        # staff tries to create a table
        rooms = requests.get(f"{API}/t/rooms", headers=H(staff_tok)).json()
        r = requests.post(f"{API}/t/tables", json={
            "room_id": rooms[0]["id"], "name": "TX", "seats": 2}, headers=H(staff_tok))
        assert r.status_code == 403

    def test_staff_cannot_assign_role_above(self, admin_token, owner_access):
        # Reuse existing or create another staff user, try to add a manager
        suffix = uuid.uuid4().hex[:6]
        email = f"TEST_staff2_{suffix}@example.com"
        requests.post(f"{API}/t/users", json={
            "name": "TEST Staff2", "email": email, "password": "StaffPass1!", "tenant_role": "staff"
        }, headers=H(owner_access))
        staff_tok = _login(email, "StaffPass1!").json()["access_token"]
        r = requests.post(f"{API}/t/users", json={
            "name": "x", "email": f"xx_{suffix}@example.com", "password": "StaffPass1!",
            "tenant_role": "manager"
        }, headers=H(staff_tok))
        # staff doesn't even have manager permission for /t/users POST → 403
        assert r.status_code == 403
