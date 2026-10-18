import os
import logging
from datetime import datetime, timezone
from html import escape
from core import db, now_iso
from services.email import send_email
from services import whatsapp

logger = logging.getLogger("ristoos.notify")

DAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]


def fmt_date(d: str) -> str:
    dt = datetime.strptime(d, "%Y-%m-%d")
    return f"{DAYS[dt.weekday()]} {dt.day} {MONTHS[dt.month - 1]} {dt.year}"


def base_url() -> str:
    return os.environ.get("APP_URL", "").rstrip("/")


def _layout(tenant: dict, title: str, intro: str, res: dict, footer_note: str) -> str:
    link = f"{base_url()}/r/{tenant['slug']}/prenota"
    contact = " · ".join(x for x in [tenant.get("address"), tenant.get("phone")] if x)
    return (
        '<table role="presentation" width="100%" style="background:#FDFBF7;padding:32px 0"><tr><td align="center">'
        '<table role="presentation" width="520" style="background:#ffffff;border:1px solid #e7e0d3;border-radius:12px;'
        'font-family:Arial,Helvetica,sans-serif;color:#292524"><tr><td style="padding:32px">'
        f'<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#D97706;font-weight:700">{escape(tenant["name"])}</div>'
        f'<h1 style="font-size:24px;margin:8px 0 20px">{title}</h1>'
        f'<p style="font-size:16px;line-height:1.6">Ciao {escape(res["name"])},<br>{intro}</p>'
        '<table role="presentation" style="background:#FDFBF7;border-radius:8px;padding:16px;margin:20px 0;width:100%">'
        f'<tr><td style="padding:6px 12px;color:#78716c">Data</td><td style="padding:6px 12px;font-weight:700">{escape(fmt_date(res["date"]))}</td></tr>'
        f'<tr><td style="padding:6px 12px;color:#78716c">Ora</td><td style="padding:6px 12px;font-weight:700">{escape(res["time"])}</td></tr>'
        f'<tr><td style="padding:6px 12px;color:#78716c">Persone</td><td style="padding:6px 12px;font-weight:700">{res["guests"]}</td></tr>'
        + (f'<tr><td style="padding:6px 12px;color:#78716c">Note</td><td style="padding:6px 12px">{escape(res["notes"])}</td></tr>' if res.get("notes") else "")
        + '</table>'
        f'<p style="font-size:14px;line-height:1.6;color:#57534e">{footer_note}</p>'
        + (f'<p style="font-size:14px;color:#57534e">{escape(contact)}</p>' if contact else "")
        + (f'<p style="margin-top:24px"><a href="{escape(link)}" style="color:#D97706;font-weight:700">Prenota di nuovo</a></p>' if base_url().startswith("https://") else "")
        + f'<p style="font-size:12px;color:#a8a29e;margin-top:24px">Email inviata da {escape(os.environ["EMAIL_FROM_NAME"])} per conto di {escape(tenant["name"])}. '
        'Non chiediamo mai password o dati di pagamento via email.</p>'
        '</td></tr></table></td></tr></table>'
    )


TEMPLATES = {
    "ricevuta": lambda t, r: (f"Richiesta di prenotazione ricevuta — {t['name']}", _layout(
        t, "Richiesta ricevuta", "abbiamo ricevuto la tua richiesta di prenotazione. Ti confermeremo al più presto.", r,
        "Riceverai una seconda email appena il ristorante conferma il tavolo.")),
    "conferma": lambda t, r: (f"Prenotazione confermata — {t['name']}", _layout(
        t, "Prenotazione confermata", "il tuo tavolo è confermato. Ti aspettiamo!", r,
        "Se hai bisogno di modificare o annullare, contatta direttamente il ristorante.")),
    "promemoria": lambda t, r: (f"Promemoria: oggi da {t['name']} alle {r['time']}", _layout(
        t, "Ti aspettiamo oggi", "ti ricordiamo la tua prenotazione di oggi.", r,
        "Se non puoi venire, avvisaci: ci aiuta a gestire al meglio la sala.")),
}


WA_TEXT = {
    "ricevuta": lambda t, r: f"Ciao {r['name']}, {t['name']} ha ricevuto la tua richiesta di prenotazione per {r['guests']} persone {fmt_date(r['date'])} alle {r['time']}. Ti confermeremo al più presto.",
    "conferma": lambda t, r: f"Ciao {r['name']}, la tua prenotazione da {t['name']} è confermata: {fmt_date(r['date'])} alle {r['time']}, {r['guests']} persone. Ti aspettiamo!",
    "promemoria": lambda t, r: f"Ciao {r['name']}, ti ricordiamo la prenotazione di oggi da {t['name']} alle {r['time']} per {r['guests']} persone. Se non puoi venire, avvisaci. A dopo!",
}


async def notify_reservation(reservation_id: str, kind: str) -> bool:
    res = await db.reservations.find_one({"_id": reservation_id})
    if not res:
        return False
    tenant = await db.tenants.find_one({"_id": res["tenant_id"]})
    if not tenant:
        return False
    ok = False
    if res.get("email"):
        subject, html = TEMPLATES[kind](tenant, res)
        try:
            await send_email(to=res["email"], subject=subject, html=html, reply_to=tenant.get("notify_reply_to") or None)
            await db.reservations.update_one({"_id": reservation_id}, {"$set": {f"notify.{kind}": now_iso()}, "$unset": {f"notify.{kind}_error": ""}})
            ok = True
        except Exception as e:
            logger.warning(f"Reservation email {kind} failed for {reservation_id}: {e}")
            await db.reservations.update_one({"_id": reservation_id}, {"$set": {f"notify.{kind}_error": str(e)[:200]}})
    if tenant.get("whatsapp_enabled") and whatsapp.configured() and res.get("phone"):
        try:
            sid = await whatsapp.send_whatsapp(res["phone"], WA_TEXT[kind](tenant, res))
            if sid:
                await db.reservations.update_one({"_id": reservation_id}, {"$set": {f"notify.{kind}_wa": now_iso()}})
                ok = True
        except Exception as e:
            await db.reservations.update_one({"_id": reservation_id}, {"$set": {f"notify.{kind}_wa_error": str(e)[:200]}})
    return ok


async def send_daily_reminders(run_id: str):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    q = {"date": today, "status": "confermata", "notify.promemoria": {"$exists": False}, "notify.promemoria_wa": {"$exists": False},
         "$or": [{"email": {"$nin": ["", None]}}, {"phone": {"$nin": ["", None]}}]}
    sent = 0
    async for r in db.reservations.find(q):
        tenant = await db.tenants.find_one({"_id": r["tenant_id"], "active": True})
        if tenant and await notify_reservation(r["_id"], "promemoria"):
            sent += 1
    await db.cron_runs.update_one({"_id": run_id}, {"$set": {"finished_at": now_iso(), "sent": sent}})
    logger.info(f"Reminders run {run_id}: sent {sent}")
