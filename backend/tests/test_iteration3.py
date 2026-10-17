"""RistoOS iteration-3 tests: reservation emails + cron, stations, per-station order status."""
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL missing"
API = f"{BASE}/api"

OWNER_EMAIL = "owner@trattoria-demo.it"
OWNER_PASS = "Demo2026!"
DEMO_SLUG = "trattoria-demo"
TEST_EMAIL = "delivered@resend.dev"


def _read_cron_secret():
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("WEBHOOK_CRON_SECRET"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


CRON_SECRET = _read_cron_secret()


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_tok():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def today_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ---------- Cron auth / idempotency ----------
class TestCron:
    def test_cron_no_auth_returns_401(self):
        r = requests.post(f"{API}/cron/reservation-reminders", json={})
        assert r.status_code == 401

    def test_cron_bad_token_returns_401(self):
        r = requests.post(f"{API}/cron/reservation-reminders",
                          json={}, headers={"Authorization": "Bearer wrong"})
        assert r.status_code == 401

    def test_cron_accepted_then_duplicate(self, owner_tok, today_str):
        # Create today's confermata reservation with email
        r = requests.post(f"{API}/t/reservations",
                          json={"date": today_str, "time": "20:00", "guests": 2,
                                "name": "TEST Cron", "email": TEST_EMAIL,
                                "status": "confermata"},
                          headers=H(owner_tok))
        assert r.status_code == 201, r.text
        res_id = r.json()["id"]

        run_id = f"test-{uuid.uuid4().hex[:10]}"
        headers = {"Authorization": f"Bearer {CRON_SECRET}", "X-Webhook-Id": run_id}
        r = requests.post(f"{API}/cron/reservation-reminders", json={}, headers=headers)
        assert r.status_code == 202, r.text
        assert r.json()["status"] == "accepted"

        # Same X-Webhook-Id -> duplicate
        r2 = requests.post(f"{API}/cron/reservation-reminders", json={}, headers=headers)
        assert r2.status_code == 202
        assert r2.json()["status"] == "duplicate"

        # Wait for background job
        time.sleep(6)
        reservations = requests.get(f"{API}/t/reservations?date={today_str}",
                                    headers=H(owner_tok)).json()
        mine = next((x for x in reservations if x["id"] == res_id), None)
        assert mine, "reservation not found"
        notify = mine.get("notify") or {}
        # Promemoria should be set (unless rate-limited by email proxy)
        if "promemoria_error" in notify:
            pytest.skip(f"email proxy rate-limited: {notify.get('promemoria_error')}")
        assert "promemoria" in notify, f"expected promemoria in notify, got {notify}"
        ts1 = notify["promemoria"]

        # Trigger again with NEW run id -> should not re-send (already has promemoria)
        run_id2 = f"test-{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/cron/reservation-reminders", json={},
                          headers={"Authorization": f"Bearer {CRON_SECRET}", "X-Webhook-Id": run_id2})
        assert r.status_code == 202 and r.json()["status"] == "accepted"
        time.sleep(4)
        reservations = requests.get(f"{API}/t/reservations?date={today_str}",
                                    headers=H(owner_tok)).json()
        mine = next((x for x in reservations if x["id"] == res_id), None)
        assert mine["notify"]["promemoria"] == ts1, "promemoria was re-sent"

        # cleanup
        requests.delete(f"{API}/t/reservations/{res_id}", headers=H(owner_tok))


# ---------- Email on status change ----------
class TestReservationEmails:
    def test_in_attesa_no_conferma_then_confermata_sends(self, owner_tok, today_str):
        r = requests.post(f"{API}/t/reservations",
                          json={"date": today_str, "time": "19:30", "guests": 2,
                                "name": "TEST Conf", "email": TEST_EMAIL,
                                "status": "in_attesa"},
                          headers=H(owner_tok))
        assert r.status_code == 201
        rid = r.json()["id"]
        assert "conferma" not in (r.json().get("notify") or {})

        # Patch to confermata
        r = requests.patch(f"{API}/t/reservations/{rid}",
                           json={"status": "confermata"}, headers=H(owner_tok))
        assert r.status_code == 200
        time.sleep(5)
        res = next(x for x in requests.get(f"{API}/t/reservations?date={today_str}",
                                           headers=H(owner_tok)).json() if x["id"] == rid)
        notify = res.get("notify") or {}
        if "conferma_error" in notify:
            pytest.skip(f"email proxy rate-limited: {notify['conferma_error']}")
        assert "conferma" in notify
        requests.delete(f"{API}/t/reservations/{rid}", headers=H(owner_tok))

    def test_no_email_no_notify_and_notify_400(self, owner_tok, today_str):
        r = requests.post(f"{API}/t/reservations",
                          json={"date": today_str, "time": "21:00", "guests": 2,
                                "name": "TEST NoMail", "status": "confermata"},
                          headers=H(owner_tok))
        rid = r.json()["id"]
        time.sleep(2)
        res = next(x for x in requests.get(f"{API}/t/reservations?date={today_str}",
                                           headers=H(owner_tok)).json() if x["id"] == rid)
        assert not (res.get("notify") or {})

        r = requests.post(f"{API}/t/reservations/{rid}/notify",
                          json={"kind": "promemoria"}, headers=H(owner_tok))
        assert r.status_code == 400
        requests.delete(f"{API}/t/reservations/{rid}", headers=H(owner_tok))

    def test_notify_invalid_kind_400(self, owner_tok, today_str):
        r = requests.post(f"{API}/t/reservations",
                          json={"date": today_str, "time": "21:30", "guests": 2,
                                "name": "TEST Bad", "email": TEST_EMAIL,
                                "status": "in_attesa"},
                          headers=H(owner_tok))
        rid = r.json()["id"]
        r = requests.post(f"{API}/t/reservations/{rid}/notify",
                          json={"kind": "nope"}, headers=H(owner_tok))
        assert r.status_code == 400
        requests.delete(f"{API}/t/reservations/{rid}", headers=H(owner_tok))


# ---------- Stations settings ----------
class TestStationsSettings:
    def test_default_stations_present(self, owner_tok):
        s = requests.get(f"{API}/t/settings", headers=H(owner_tok)).json()
        stations = s.get("stations") or []
        ids = {st["id"] for st in stations}
        assert {"cucina", "pizzeria", "bar"}.issubset(ids), f"got {ids}"

    def test_patch_stations_and_blank_rejected(self, owner_tok):
        # Patch with partial - new generated id for Griglia
        r = requests.patch(f"{API}/t/settings",
                           json={"stations": [
                               {"id": "cucina", "name": "Cucina", "color": "#F59E0B"},
                               {"name": "Griglia", "color": "#10B981"}]},
                           headers=H(owner_tok))
        assert r.status_code == 200
        new = r.json()["stations"]
        assert len(new) == 2
        griglia = next(s for s in new if s["name"] == "Griglia")
        assert griglia["id"] and griglia["id"] != "cucina"

        # All blank names -> 400
        r = requests.patch(f"{API}/t/settings",
                           json={"stations": [{"name": ""}, {"name": "   "}]},
                           headers=H(owner_tok))
        assert r.status_code == 400

        # Restore defaults
        r = requests.patch(f"{API}/t/settings",
                           json={"stations": [
                               {"id": "cucina", "name": "Cucina", "color": "#F59E0B"},
                               {"id": "pizzeria", "name": "Pizzeria", "color": "#EF4444"},
                               {"id": "bar", "name": "Bar", "color": "#3B82F6"}]},
                           headers=H(owner_tok))
        assert r.status_code == 200
        ids = {s["id"] for s in r.json()["stations"]}
        assert ids == {"cucina", "pizzeria", "bar"}


# ---------- Station assignment on menu + order routing ----------
class TestStationAssignment:
    def test_category_item_station_and_public_order_routes(self, owner_tok):
        cats = requests.get(f"{API}/t/menu/categories", headers=H(owner_tok)).json()
        items = requests.get(f"{API}/t/menu/items", headers=H(owner_tok)).json()
        bev = next((c for c in cats if "evande" in c["name"]), None)
        pizza = next((i for i in items if "Margherita" in i["name"]), None)
        birra = next((i for i in items if "Birra" in i["name"]), None)
        assert bev and pizza and birra, "demo seed items missing"

        # Assign Bevande -> bar
        r = requests.patch(f"{API}/t/menu/categories/{bev['id']}",
                           json={"name": bev["name"], "name_en": bev.get("name_en", ""),
                                 "station_id": "bar"}, headers=H(owner_tok))
        assert r.status_code == 200 and r.json()["station_id"] == "bar"

        # Assign Pizza -> pizzeria
        r = requests.patch(f"{API}/t/menu/items/{pizza['id']}",
                           json={"station_id": "pizzeria"}, headers=H(owner_tok))
        assert r.status_code == 200 and r.json()["station_id"] == "pizzeria"

        # Clear station on pizza then re-set
        r = requests.patch(f"{API}/t/menu/items/{pizza['id']}",
                           json={"clear_station": True}, headers=H(owner_tok))
        assert r.status_code == 200 and r.json().get("station_id") is None
        requests.patch(f"{API}/t/menu/items/{pizza['id']}",
                       json={"station_id": "pizzeria"}, headers=H(owner_tok))

        # Place public QR order with pizza + birra on a free table
        tables = requests.get(f"{API}/t/tables", headers=H(owner_tok)).json()
        bills = requests.get(f"{API}/t/bills", headers=H(owner_tok)).json()
        busy = {b["table_id"] for b in bills}
        tgt = next((t for t in tables if t["name"] in ("T6", "T7", "T8", "D2", "D3")
                    and t["id"] not in busy), None)
        assert tgt, "no free target table"

        r = requests.post(f"{API}/public/{DEMO_SLUG}/orders",
                          json={"table_code": tgt["code"], "customer_name": "TEST_station",
                                "lines": [{"item_id": pizza["id"], "qty": 1},
                                          {"item_id": birra["id"], "qty": 1}]})
        assert r.status_code == 201, r.text
        order = r.json()
        line_stations = {l["name"]: l["station_id"] for l in order["items"]}
        assert line_stations.get(pizza["name"]) == "pizzeria"
        assert line_stations.get(birra["name"]) == "bar"
        assert order["stations"] == {"pizzeria": "nuovo", "bar": "nuovo"}

        # Per-station status transitions
        oid = order["id"]
        # move bar to in_preparazione
        r = requests.patch(f"{API}/t/orders/{oid}/status",
                           json={"status": "in_preparazione", "station_id": "bar"},
                           headers=H(owner_tok))
        assert r.status_code == 200
        d = r.json()
        assert d["stations"]["bar"] == "in_preparazione"
        assert d["stations"]["pizzeria"] == "nuovo"
        assert d["status"] == "in_preparazione"

        # bar -> pronto; order still in_preparazione (pizzeria still nuovo)
        r = requests.patch(f"{API}/t/orders/{oid}/status",
                           json={"status": "pronto", "station_id": "bar"},
                           headers=H(owner_tok)).json()
        assert r["status"] == "in_preparazione"

        # pizzeria -> pronto; order now pronto (all pronto)
        r = requests.patch(f"{API}/t/orders/{oid}/status",
                           json={"status": "pronto", "station_id": "pizzeria"},
                           headers=H(owner_tok)).json()
        assert r["status"] == "pronto"
        assert r["stations"]["pizzeria"] == "pronto"

        # unknown station -> 400
        r = requests.patch(f"{API}/t/orders/{oid}/status",
                           json={"status": "pronto", "station_id": "ghost"},
                           headers=H(owner_tok))
        assert r.status_code == 400

        # no station, status=nuovo -> all stations nuovo
        r = requests.patch(f"{API}/t/orders/{oid}/status",
                           json={"status": "nuovo"}, headers=H(owner_tok)).json()
        assert r["stations"] == {"pizzeria": "nuovo", "bar": "nuovo"}
        assert r["status"] == "nuovo"

        # servito w/o station -> overall servito
        r = requests.patch(f"{API}/t/orders/{oid}/status",
                           json={"status": "servito"}, headers=H(owner_tok)).json()
        assert r["status"] == "servito"

    def test_bill_add_item_sets_station(self, owner_tok):
        tables = requests.get(f"{API}/t/tables", headers=H(owner_tok)).json()
        bills = requests.get(f"{API}/t/bills", headers=H(owner_tok)).json()
        busy = {b["table_id"] for b in bills}
        tgt = next((t for t in tables if t["name"] in ("T7", "T8", "D3") and t["id"] not in busy), None)
        assert tgt
        bill = requests.post(f"{API}/t/bills/open", json={"table_id": tgt["id"]},
                             headers=H(owner_tok)).json()
        bid = bill["id"]
        items = requests.get(f"{API}/t/menu/items", headers=H(owner_tok)).json()
        pizza = next(i for i in items if "Margherita" in i["name"])
        r = requests.post(f"{API}/t/bills/{bid}/items",
                          json={"item_id": pizza["id"], "qty": 1, "send_to_kitchen": True},
                          headers=H(owner_tok))
        assert r.status_code == 200, r.text
        # Related order carries station_id on items and stations map
        orders = requests.get(f"{API}/t/orders", headers=H(owner_tok)).json()
        cassa = [o for o in orders if o.get("bill_id") == bid and o.get("source") == "cassa"]
        assert cassa, "no cassa order created"
        assert cassa[0]["items"][0].get("station_id") == "pizzeria"
        assert cassa[0]["stations"].get("pizzeria") == "nuovo"
        # cleanup
        rem = requests.get(f"{API}/t/bills/{bid}", headers=H(owner_tok)).json()["remaining"]
        if rem > 0:
            requests.post(f"{API}/t/bills/{bid}/payments",
                          json={"method": "contanti", "amount": rem}, headers=H(owner_tok))
        requests.post(f"{API}/t/bills/{bid}/close", headers=H(owner_tok))
