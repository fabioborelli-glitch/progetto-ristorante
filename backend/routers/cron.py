import os
import hmac
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from core import db, now_iso
from services.notify import send_daily_reminders

router = APIRouter(prefix="/cron", tags=["cron"])


def check_auth(request: Request):
    auth = request.headers.get("Authorization", "")
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not auth.startswith("Bearer ") or not secret or not hmac.compare_digest(auth[7:], secret):
        raise HTTPException(status_code=401, detail="Non autorizzato")


@router.post("/reservation-reminders", status_code=202)
async def reservation_reminders(request: Request, background: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    check_auth(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body non valido")
    run_id = request.headers.get("X-Webhook-Id") or body.get("run_id") or now_iso()
    existing = await db.cron_runs.find_one({"_id": run_id})
    if existing:
        return {"status": "duplicate", "run_id": run_id}
    await db.cron_runs.insert_one({"_id": run_id, "job": "reservation-reminders", "started_at": now_iso()})
    background.add_task(send_daily_reminders, run_id)
    return {"status": "accepted", "run_id": run_id}
