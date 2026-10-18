"""Invoice OCR: read a supplier invoice photo/PDF and extract structured line items."""
import os
import json
import base64
import logging
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger("ristoos.ocr")

OCR_MODEL = ("gemini", "gemini-3-flash-preview")

SYSTEM = (
    "Sei un assistente che legge FATTURE e DDT di fornitori italiani per ristoranti. "
    "Estrai i dati in JSON puro, senza testo extra. Interpreta correttamente numeri in formato "
    "italiano (virgola = decimali). Se un campo manca usa null."
)

PROMPT = (
    "Leggi questa fattura/documento di trasporto e restituisci SOLO un oggetto JSON con questa forma:\n"
    '{"supplier_name": string|null, "date": "YYYY-MM-DD"|null, "document_number": string|null, '
    '"lines": [{"name": string, "qty": number|null, "unit": string|null, "unit_cost": number|null, "total": number|null}]}\n'
    "Regole: name = descrizione articolo pulita; unit tra pz,kg,g,l,ml,bt,cf,cl se deducibile; "
    "unit_cost = prezzo unitario netto (senza IVA se distinguibile); non inventare righe. "
    "Rispondi con il solo JSON."
)


def _strip_json(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1] if "```" in t[3:] else t[3:]
        if t.startswith("json"):
            t = t[4:]
    t = t.strip().strip("`").strip()
    start, end = t.find("{"), t.rfind("}")
    return t[start:end + 1] if start >= 0 and end > start else t


async def extract_invoice(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY mancante")
    chat = LlmChat(api_key=key, session_id="invoice-ocr", system_message=SYSTEM).with_model(*OCR_MODEL)
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    msg = UserMessage(text=PROMPT, file_contents=[ImageContent(image_base64=b64)])
    resp = await chat.send_message(msg)
    raw = resp if isinstance(resp, str) else getattr(resp, "content", str(resp))
    try:
        data = json.loads(_strip_json(raw))
    except Exception:
        logger.error("OCR parse failed: %s", raw[:500])
        raise RuntimeError("Non sono riuscito a leggere la fattura. Riprova con una foto più nitida.")
    lines = []
    for l in data.get("lines") or []:
        name = (l.get("name") or "").strip()
        if not name:
            continue
        lines.append({"name": name, "qty": l.get("qty"), "unit": l.get("unit"),
                      "unit_cost": l.get("unit_cost"), "total": l.get("total")})
    return {"supplier_name": data.get("supplier_name"), "date": data.get("date"),
            "document_number": data.get("document_number"), "lines": lines}
