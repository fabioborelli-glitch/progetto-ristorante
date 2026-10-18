"""Iteration 4: Waitlist, WhatsApp (disabled graceful behavior), KDS warn/alert settings."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
OWNER = {"email": "owner@trattoria-demo.it", "password": "Demo2026!"}
SUPER = {"email": "fabio.borelli@icloud.com", "password": "RistoOS2026!"}


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=OWNER, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def owner_h(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="module")
def super_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=SUPER, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tenant_slug():
    return "trattoria-demo"


# ============== Settings & WhatsApp availability ==============

class TestSettingsAndWhatsApp:
    def test_settings_has_whatsapp_available_false(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/t/settings", headers=owner_h, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("whatsapp_available") is False
        # whatsapp_enabled may be absent (default false) or False
        assert d.get("whatsapp_enabled") in (False, None)
        assert d.get("kds_warn_minutes", 15) == 15 or isinstance(d.get("kds_warn_minutes"), int)
        assert d.get("kds_alert_minutes", 25) == 25 or isinstance(d.get("kds_alert_minutes"), int)

    def test_patch_settings_kds_and_wa_enabled(self, owner_h):
        r = requests.patch(f"{BASE_URL}/api/t/settings", headers=owner_h,
                           json={"kds_warn_minutes": 10, "kds_alert_minutes": 20, "whatsapp_enabled": True},
                           timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["kds_warn_minutes"] == 10
        assert d["kds_alert_minutes"] == 20
        assert d["whatsapp_enabled"] is True

    def test_create_phone_only_confermata_no_error(self, owner_h):
        # whatsapp_enabled true but not configured -> should NOT error, status 201
        r = requests.post(f"{BASE_URL}/api/t/reservations", headers=owner_h, json={
            "date": "2030-01-15", "time": "20:00", "guests": 2,
            "name": "TEST WA Phone Only", "phone": "+393331112233", "status": "confermata"
        }, timeout=10)
        assert r.status_code == 201, r.text
        res_id = r.json()["id"]
        # wait for background task
        time.sleep(2)
        g = requests.get(f"{BASE_URL}/api/t/reservations?date=2030-01-15", headers=owner_h, timeout=10).json()
        this = next(x for x in g if x["id"] == res_id)
        notify = this.get("notify") or {}
        # No channel active: no _wa keys and no email keys
        assert "conferma_wa" not in notify
        # cleanup
        requests.delete(f"{BASE_URL}/api/t/reservations/{res_id}", headers=owner_h, timeout=10)

    def test_notify_phone_only_502(self, owner_h):
        # create phone-only confermata
        r = requests.post(f"{BASE_URL}/api/t/reservations", headers=owner_h, json={
            "date": "2030-01-16", "time": "20:00", "guests": 2,
            "name": "TEST WA Notify", "phone": "+393331112244", "status": "confermata"
        }, timeout=10)
        rid = r.json()["id"]
        n = requests.post(f"{BASE_URL}/api/t/reservations/{rid}/notify", headers=owner_h,
                          json={"kind": "conferma"}, timeout=15)
        assert n.status_code == 502, f"{n.status_code} body={n.text!r}"
        try:
            detail = n.json().get("detail", "").lower()
            assert "canale" in detail or "nessun" in detail or "wa" in detail
        except ValueError:
            # ingress returned non-JSON 502 — still acceptable per spec (status 502)
            pass
        requests.delete(f"{BASE_URL}/api/t/reservations/{rid}", headers=owner_h, timeout=10)

    def test_notify_without_email_or_phone_400(self, owner_h):
        r = requests.post(f"{BASE_URL}/api/t/reservations", headers=owner_h, json={
            "date": "2030-01-17", "time": "20:00", "guests": 2,
            "name": "TEST No Contact", "status": "confermata"
        }, timeout=10)
        rid = r.json()["id"]
        n = requests.post(f"{BASE_URL}/api/t/reservations/{rid}/notify", headers=owner_h,
                          json={"kind": "conferma"}, timeout=10)
        assert n.status_code == 400
        requests.delete(f"{BASE_URL}/api/t/reservations/{rid}", headers=owner_h, timeout=10)

    def test_restore_settings(self, owner_h):
        r = requests.patch(f"{BASE_URL}/api/t/settings", headers=owner_h,
                           json={"kds_warn_minutes": 15, "kds_alert_minutes": 25, "whatsapp_enabled": False},
                           timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["whatsapp_enabled"] is False
        assert d["kds_warn_minutes"] == 15
        assert d["kds_alert_minutes"] == 25


# ============== Waitlist API ==============

_wl_state = {}


class TestWaitlist:
    def test_add_waitlist(self, owner_h):
        r = requests.post(f"{BASE_URL}/api/t/waitlist", headers=owner_h,
                          json={"name": "TEST WL One", "guests": 2, "phone": "+393330000001",
                                "quoted_minutes": 20, "notes": "finestra"}, timeout=10)
        assert r.status_code == 201, r.text
        d = r.json()
        assert len(d["code"]) == 5
        assert d["status"] == "in_attesa"
        assert isinstance(d["position"], int) and d["position"] >= 1
        _wl_state["id1"] = d["id"]
        _wl_state["code1"] = d["code"]
        _wl_state["pos1"] = d["position"]

    def test_add_waitlist_guests_invalid(self, owner_h):
        r = requests.post(f"{BASE_URL}/api/t/waitlist", headers=owner_h,
                          json={"name": "TEST Bad", "guests": 0}, timeout=10)
        assert r.status_code == 400

    def test_add_second_waitlist_position_increases(self, owner_h):
        r = requests.post(f"{BASE_URL}/api/t/waitlist", headers=owner_h,
                          json={"name": "TEST WL Two", "guests": 3, "phone": "+393330000002"}, timeout=10)
        assert r.status_code == 201
        d = r.json()
        assert d["position"] == _wl_state["pos1"] + 1
        _wl_state["id2"] = d["id"]

    def test_list_waitlist(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/t/waitlist", headers=owner_h, timeout=10)
        assert r.status_code == 200
        lst = r.json()
        ids = {e["id"] for e in lst}
        assert _wl_state["id1"] in ids and _wl_state["id2"] in ids
        for e in lst:
            if e["status"] == "in_attesa":
                assert isinstance(e["position"], int)
            else:
                assert e["position"] is None

    def test_patch_chiamato(self, owner_h):
        r = requests.patch(f"{BASE_URL}/api/t/waitlist/{_wl_state['id1']}", headers=owner_h,
                           json={"status": "chiamato"}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "chiamato"
        assert d.get("called_at")
        # remaining in_attesa (id2) should be position 1
        lst = requests.get(f"{BASE_URL}/api/t/waitlist", headers=owner_h, timeout=10).json()
        e2 = next(e for e in lst if e["id"] == _wl_state["id2"])
        assert e2["position"] == 1

    def test_patch_invalid_status(self, owner_h):
        r = requests.patch(f"{BASE_URL}/api/t/waitlist/{_wl_state['id2']}", headers=owner_h,
                           json={"status": "invalid"}, timeout=10)
        assert r.status_code == 400

    def test_patch_seduto_sets_table_occupato(self, owner_h):
        # find free table
        tables = requests.get(f"{BASE_URL}/api/t/tables", headers=owner_h, timeout=10).json()
        free = next((t for t in tables if t["status"] == "libero"), None)
        if not free:
            pytest.skip("no free table")
        _wl_state["table_id"] = free["id"]
        r = requests.patch(f"{BASE_URL}/api/t/waitlist/{_wl_state['id2']}", headers=owner_h,
                           json={"status": "seduto", "table_id": free["id"]}, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "seduto"
        assert d.get("seated_at")
        # verify table occupato
        tables2 = requests.get(f"{BASE_URL}/api/t/tables", headers=owner_h, timeout=10).json()
        t = next(x for x in tables2 if x["id"] == free["id"])
        assert t["status"] == "occupato"

    def test_patch_unknown_table_404(self, owner_h):
        r = requests.post(f"{BASE_URL}/api/t/waitlist", headers=owner_h,
                          json={"name": "TEST BadTbl", "guests": 2}, timeout=10)
        wid = r.json()["id"]
        _wl_state["id_bad"] = wid
        rr = requests.patch(f"{BASE_URL}/api/t/waitlist/{wid}", headers=owner_h,
                            json={"status": "seduto", "table_id": "nonexistent-table-id"}, timeout=10)
        assert rr.status_code == 404

    def test_public_waitlist_lowercase(self, tenant_slug):
        code = _wl_state["code1"].lower()
        r = requests.get(f"{BASE_URL}/api/public/{tenant_slug}/waitlist/{code}", timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "TEST WL One"
        assert d["status"] == "chiamato"
        assert d["guests"] == 2
        assert "restaurant" in d and d["restaurant"]["name"]

    def test_public_waitlist_404(self, tenant_slug):
        r = requests.get(f"{BASE_URL}/api/public/{tenant_slug}/waitlist/ZZZZZ", timeout=10)
        assert r.status_code == 404

    def test_public_ahead_count(self, owner_h, tenant_slug):
        # Create 2 fresh in_attesa and check ahead count on second
        a = requests.post(f"{BASE_URL}/api/t/waitlist", headers=owner_h,
                          json={"name": "TEST Ahead A", "guests": 2}, timeout=10).json()
        time.sleep(1)
        b = requests.post(f"{BASE_URL}/api/t/waitlist", headers=owner_h,
                          json={"name": "TEST Ahead B", "guests": 2}, timeout=10).json()
        _wl_state["id_a"] = a["id"]; _wl_state["id_b"] = b["id"]
        r = requests.get(f"{BASE_URL}/api/public/{tenant_slug}/waitlist/{b['code']}", timeout=10)
        assert r.status_code == 200
        d = r.json()
        # ahead counts only in_attesa created before -> should include at least a
        assert d["ahead"] >= 1

    def test_delete_waitlist_owner(self, owner_h):
        for key in ("id_bad", "id_a", "id_b"):
            if _wl_state.get(key):
                r = requests.delete(f"{BASE_URL}/api/t/waitlist/{_wl_state[key]}", headers=owner_h, timeout=10)
                assert r.status_code in (200, 204), f"{key}: {r.status_code} {r.text}"

    def test_cleanup_seated_table(self, owner_h):
        # restore table status to libero
        tid = _wl_state.get("table_id")
        if tid:
            requests.patch(f"{BASE_URL}/api/t/tables/{tid}", headers=owner_h,
                           json={"status": "libero"}, timeout=10)
        # delete remaining test waitlist entries
        for wid in (_wl_state.get("id1"), _wl_state.get("id2")):
            if wid:
                requests.delete(f"{BASE_URL}/api/t/waitlist/{wid}", headers=owner_h, timeout=10)


# ============== Role-based access & tenant isolation ==============

class TestWaitlistRBACAndIsolation:
    @pytest.fixture
    def staff_token(self, owner_h):
        # create a staff user, login, then delete after
        email = f"test_staff_wl_{int(time.time())}@example.com"
        r = requests.post(f"{BASE_URL}/api/t/users", headers=owner_h, json={
            "name": "TEST Staff WL", "email": email, "password": "Testpass123!", "tenant_role": "staff"
        }, timeout=10)
        assert r.status_code == 201, r.text
        uid = r.json()["id"]
        login = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": email, "password": "Testpass123!"}, timeout=10)
        token = login.json()["access_token"]
        yield token
        requests.delete(f"{BASE_URL}/api/t/users/{uid}", headers=owner_h, timeout=10)

    def test_staff_cannot_delete(self, owner_h, staff_token):
        # create entry as owner
        r = requests.post(f"{BASE_URL}/api/t/waitlist", headers=owner_h,
                          json={"name": "TEST StaffDel", "guests": 2}, timeout=10)
        wid = r.json()["id"]
        # staff attempt delete
        rr = requests.delete(f"{BASE_URL}/api/t/waitlist/{wid}",
                             headers={"Authorization": f"Bearer {staff_token}"}, timeout=10)
        assert rr.status_code == 403
        requests.delete(f"{BASE_URL}/api/t/waitlist/{wid}", headers=owner_h, timeout=10)

    def test_tenant_isolation(self, super_token, owner_h):
        # Create another tenant via superadmin
        headers = {"Authorization": f"Bearer {super_token}"}
        slug = f"test-iso-{int(time.time())}"
        r = requests.post(f"{BASE_URL}/api/admin/tenants", headers=headers, json={
            "name": "TEST Iso", "slug": slug,
            "owner_email": f"owner_{slug}@example.com", "owner_name": "TEST Iso Owner",
            "owner_password": "Testpass123!", "send_invite": False
        }, timeout=15)
        if r.status_code not in (200, 201):
            pytest.skip(f"cannot create tenant: {r.status_code} {r.text}")
        tenant_id = r.json().get("id") or r.json().get("tenant", {}).get("id")
        # login as new owner
        login = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": f"owner_{slug}@example.com", "password": "Testpass123!"},
                              timeout=10)
        if login.status_code != 200:
            pytest.skip(f"cannot login new owner: {login.text}")
        other_token = login.json()["access_token"]

        # Create waitlist entry on trattoria-demo as owner
        wr = requests.post(f"{BASE_URL}/api/t/waitlist", headers=owner_h,
                           json={"name": "TEST Iso Entry", "guests": 2}, timeout=10)
        wid = wr.json()["id"]
        # Other owner tries to patch
        pr = requests.patch(f"{BASE_URL}/api/t/waitlist/{wid}",
                            headers={"Authorization": f"Bearer {other_token}"},
                            json={"status": "chiamato"}, timeout=10)
        assert pr.status_code == 404
        # cleanup
        requests.delete(f"{BASE_URL}/api/t/waitlist/{wid}", headers=owner_h, timeout=10)
        # delete the test tenant via admin
        if tenant_id:
            requests.delete(f"{BASE_URL}/api/admin/tenants/{tenant_id}", headers=headers, timeout=10)
