import os
import re
import asyncio
import logging

logger = logging.getLogger("ristoos.whatsapp")


def configured() -> bool:
    return all(os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"))


def normalize_phone(raw: str) -> str | None:
    digits = re.sub(r"[^\d+]", "", raw or "")
    if not digits:
        return None
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if not digits.startswith("+"):
        digits = "+39" + digits.lstrip("0") if len(digits) <= 10 else "+" + digits
    return digits if len(digits) >= 9 else None


def _send_sync(to: str, body: str) -> str:
    from twilio.rest import Client
    client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
    frm = os.environ["TWILIO_WHATSAPP_FROM"]
    if not frm.startswith("whatsapp:"):
        frm = f"whatsapp:{frm}"
    msg = client.messages.create(from_=frm, to=f"whatsapp:{to}", body=body)
    return msg.sid


async def send_whatsapp(to_raw: str, body: str) -> str | None:
    if not configured():
        return None
    to = normalize_phone(to_raw)
    if not to:
        return None
    try:
        return await asyncio.to_thread(_send_sync, to, body)
    except Exception as e:
        logger.warning(f"WhatsApp send failed to {to}: {e}")
        raise
