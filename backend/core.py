import os
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import Request, HTTPException, Depends
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

JWT_ALGORITHM = "HS256"
TENANT_ROLES = ["owner", "manager", "staff"]
ROLE_RANK = {"owner": 3, "manager": 2, "staff": 1}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def ser(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    d = dict(doc)
    d["id"] = d.pop("_id")
    d.pop("password_hash", None)
    return d


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "type": "access",
               "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "type": "refresh", "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


def set_auth_cookies(response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


class Principal(BaseModel):
    user_id: str
    email: str
    name: str
    platform_role: Optional[str] = None
    tenant_id: Optional[str] = None
    tenant_role: Optional[str] = None
    impersonating: bool = False


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Non autenticato")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessione scaduta")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token non valido")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token non valido")
    user = await db.users.find_one({"_id": payload["sub"]})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Utente non trovato")
    return user


async def get_principal(request: Request, user: dict = Depends(get_current_user)) -> Principal:
    p = Principal(user_id=user["_id"], email=user["email"], name=user.get("name", ""),
                  platform_role=user.get("platform_role"), tenant_id=user.get("tenant_id"),
                  tenant_role=user.get("tenant_role"))
    act_as = request.headers.get("X-Tenant-Id")
    if act_as and p.platform_role == "superadmin":
        tenant = await db.tenants.find_one({"_id": act_as})
        if not tenant:
            raise HTTPException(status_code=404, detail="Ristorante non trovato")
        p.tenant_id = act_as
        p.tenant_role = "owner"
        p.impersonating = True
    return p


async def require_superadmin(p: Principal = Depends(get_principal)) -> Principal:
    if p.platform_role != "superadmin":
        raise HTTPException(status_code=403, detail="Accesso riservato al super-admin")
    return p


def require_tenant(min_role: str = "staff"):
    async def dep(p: Principal = Depends(get_principal)) -> Principal:
        if not p.tenant_id or not p.tenant_role:
            raise HTTPException(status_code=403, detail="Nessun ristorante associato")
        if ROLE_RANK.get(p.tenant_role, 0) < ROLE_RANK[min_role]:
            raise HTTPException(status_code=403, detail="Permessi insufficienti")
        return p
    return dep


def tq(p: Principal, extra: Optional[dict] = None) -> dict:
    q = {"tenant_id": p.tenant_id}
    if extra:
        q.update(extra)
    return q


async def get_scoped_or_404(p: Principal, coll: str, doc_id: str) -> dict:
    doc = await db[coll].find_one(tq(p, {"_id": doc_id}))
    if not doc:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    return doc
