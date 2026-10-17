import asyncio
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Response
from core import db, new_id, now_iso, require_tenant, Principal
from services.storage import put_object, get_object, APP_NAME

router = APIRouter(tags=["files"])

ALLOWED = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
MAX_BYTES = 8 * 1024 * 1024


@router.post("/t/upload", status_code=201)
async def upload(file: UploadFile = File(...), p: Principal = Depends(require_tenant("manager"))):
    ctype = (file.content_type or "").lower()
    if ctype not in ALLOWED:
        raise HTTPException(status_code=400, detail="Formato non supportato: usa JPG, PNG o WEBP")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="Immagine troppo grande (max 8 MB)")
    file_id = new_id()
    path = f"{APP_NAME}/{p.tenant_id}/{file_id}.{ALLOWED[ctype]}"
    try:
        result = await asyncio.to_thread(put_object, path, data, ctype)
    except Exception:
        raise HTTPException(status_code=502, detail="Caricamento immagine fallito, riprova")
    await db.files.insert_one({"_id": file_id, "tenant_id": p.tenant_id, "storage_path": result["path"],
                               "original_filename": file.filename, "content_type": ctype, "size": len(data),
                               "is_deleted": False, "created_at": now_iso()})
    return {"id": file_id, "url": f"/api/files/{file_id}"}


@router.get("/files/{file_id}")
async def serve(file_id: str):
    rec = await db.files.find_one({"_id": file_id, "is_deleted": False})
    if not rec:
        raise HTTPException(status_code=404, detail="File non trovato")
    try:
        data, ctype = await asyncio.to_thread(get_object, rec["storage_path"])
    except Exception:
        raise HTTPException(status_code=502, detail="File non disponibile")
    return Response(content=data, media_type=rec.get("content_type") or ctype,
                    headers={"Cache-Control": "public, max-age=86400"})
