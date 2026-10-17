import os
import re
import ipaddress
import logging
import httpx
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from fastapi import HTTPException

logger = logging.getLogger("ristoos.email")

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str, reply_to: str | None = None) -> str | None:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if reply_to or EMAIL_REPLY_TO:
        payload["contact_email"] = reply_to or EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                     headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        try:
            code = e.response.json().get("code", "")
        except ValueError:
            code = ""
        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
            logger.warning(f"Email paused: {code} ({e.response.status_code})")
            raise HTTPException(status_code=503, detail="Invio email temporaneamente non disponibile")
        if e.response.status_code == 429 or code == "rate_limited":
            raise HTTPException(status_code=503, detail="Troppe email in breve tempo, riprova fra qualche minuto")
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail="Invio email fallito")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Email send error: {e}")
        raise HTTPException(status_code=500, detail="Invio email fallito")


ROLE_IT = {"owner": "Owner", "manager": "Manager", "staff": "Staff"}


async def send_invite_email(*, to: str, invitee_name: str, tenant_name: str, role: str, inviter_name: str, link: str):
    subject = f"Sei stato invitato su {EMAIL_FROM_NAME} — {tenant_name}"
    html = (
        '<table role="presentation" width="100%" style="background:#FAFAFA;padding:32px 0">'
        '<tr><td align="center">'
        '<table role="presentation" width="520" style="background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;'
        'font-family:Arial,Helvetica,sans-serif;color:#111827">'
        '<tr><td style="padding:32px">'
        f'<div style="font-size:22px;font-weight:800;margin-bottom:24px">Risto<span style="color:#E03131">OS</span></div>'
        f'<p style="font-size:16px;line-height:1.6">Ciao {escape(invitee_name)},</p>'
        f'<p style="font-size:16px;line-height:1.6">{escape(inviter_name)} ti ha invitato a far parte del team di '
        f'<strong>{escape(tenant_name)}</strong> con il ruolo <strong>{escape(ROLE_IT.get(role, role))}</strong>.</p>'
        f'<p style="font-size:16px;line-height:1.6">Per accettare l\'invito e scegliere la tua password, clicca qui sotto. '
        'Il link è valido per 7 giorni.</p>'
        f'<p style="margin:28px 0"><a href="{escape(link)}" style="background:#E03131;color:#ffffff;text-decoration:none;'
        'padding:14px 24px;border-radius:8px;font-weight:700;display:inline-block">Accetta l\'invito</a></p>'
        f'<p style="font-size:12px;color:#6B7280;line-height:1.6">Se il pulsante non funziona copia questo indirizzo nel browser:<br>'
        f'{escape(link)}</p>'
        f'<p style="font-size:12px;color:#9CA3AF;margin-top:24px">Inviato da {escape(EMAIL_FROM_NAME)}. '
        'Non chiediamo mai password o dati di pagamento via email.</p>'
        '</td></tr></table></td></tr></table>'
    )
    return await send_email(to=to, subject=subject, html=html)
