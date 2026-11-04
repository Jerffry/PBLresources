# -*- coding: utf-8 -*-
"""「格物」认证模块：访客/注册用户体系（纯标准库实现）。
- 密码：PBKDF2-HMAC-SHA256（随机盐）
- Token：HMAC-SHA256 签名的 URL-safe 载荷（uid+过期时间），30 天有效
- 访客恢复码：可用于换设备找回访客身份数据
架构对齐线上部署版：jw_token / jw_user / /api/auth/* 端点族。
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager

BASE = os.path.dirname(os.path.abspath(__file__))
SECRET_FILE = os.path.join(BASE, ".secret")
TOKEN_TTL = 30 * 24 * 3600


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def get_secret() -> str:
    """服务级密钥：首次自动生成并持久化（加入.gitignore）。"""
    if os.path.isfile(SECRET_FILE):
        return open(SECRET_FILE, encoding="utf-8").read().strip()
    sec = secrets.token_hex(32)
    with open(SECRET_FILE, "w", encoding="utf-8") as f:
        f.write(sec)
    return sec


SECRET = get_secret()


# ---------- 密码 ----------
def hash_password(pw: str) -> str:
    salt = secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 60_000)
    return f"{salt}${digest.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        salt, hexd = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 60_000)
    return hmac.compare_digest(digest.hex(), hexd)


# ---------- Token ----------
def issue_token(uid: int) -> str:
    payload = _b64e(json.dumps({"uid": uid, "exp": int(time.time()) + TOKEN_TTL}).encode())
    sig = _b64e(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def parse_token(token: str):
    """返回 uid；无效或过期返回 None。"""
    try:
        payload, sig = token.split(".", 1)
        expect = _b64e(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect):
            return None
        data = json.loads(_b64d(payload))
        if data.get("exp", 0) < time.time():
            return None
        return int(data["uid"])
    except Exception:
        return None


# ---------- 用户 ----------
@contextmanager
def db():
    conn = sqlite3.connect(os.environ.get("GEWU_DB") or os.path.join(BASE, "gewu.db"), timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def create_guest() -> dict:
    name = "访客" + secrets.token_hex(2).upper()
    recovery = "GW-" + secrets.token_hex(6).upper()
    with db() as c:
        cur = c.execute(
            "INSERT INTO users(username,pass_hash,is_guest,recovery_code) VALUES(?,?,1,?)",
            (name, "", recovery))
        uid = cur.lastrowid
    return {"id": uid, "username": name, "is_guest": True, "recovery_code": recovery}


def register_user(username: str, password: str, guest_uid=None) -> dict:
    """注册正式用户；guest_uid 有效时将其名下项目转移过来（访客升级），
    并清除其恢复码——升级后的旧恢复码不可再找回（对齐部署版语义）。"""
    with db() as c:
        cur = c.execute(
            "INSERT INTO users(username,pass_hash,is_guest) VALUES(?,?,0)",
            (username, hash_password(password)))
        uid = cur.lastrowid
        if guest_uid:
            c.execute("UPDATE projects SET user_id=? WHERE user_id=?", (uid, guest_uid))
            c.execute("UPDATE users SET recovery_code=NULL WHERE id=?", (guest_uid,))
    return {"id": uid, "username": username, "is_guest": False}


def login_user(username: str, password: str):
    with db() as c:
        row = c.execute("SELECT * FROM users WHERE username=? AND is_guest=0", (username,)).fetchone()
    if row and verify_password(password, row["pass_hash"]):
        return {"id": row["id"], "username": row["username"], "is_guest": False}
    return None


def guest_by_recovery(code: str):
    with db() as c:
        row = c.execute("SELECT * FROM users WHERE recovery_code=? AND is_guest=1", (code.strip(),)).fetchone()
    if row:
        return {"id": row["id"], "username": row["username"], "is_guest": True}
    return None


def user_by_id(uid: int):
    with db() as c:
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if row:
        return {"id": row["id"], "username": row["username"], "is_guest": bool(row["is_guest"])}
    return None


def username_exists(username: str) -> bool:
    with db() as c:
        return c.execute("SELECT 1 FROM users WHERE username=? AND is_guest=0", (username,)).fetchone() is not None
