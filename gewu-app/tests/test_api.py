# -*- coding: utf-8 -*-
"""「格物」gewu-app 回归测试套件（零第三方测试依赖，unittest + Flask test client）。
运行：cd gewu-app && python -m unittest tests.test_api -v
覆盖：认证全链路（访客/恢复码/升级/登录/隔离）· 项目 CRUD · SSE 对话与进度回写 ·
模式互导 · 方案包导出 · demo 模式节点推进。
"""
import io
import json
import os
import re
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["GEWU_DB"] = os.path.join(tempfile.mkdtemp(prefix="gewu_test_"), "test.db")

import app as gewu  # noqa: E402

gewu.app.config["TESTING"] = True


class GewuAPITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = gewu.app.test_client()

    def hdr(self, tok):
        return {"Authorization": "Bearer " + tok} if tok else {}

    def post(self, url, body=None, tok=None):
        return self.c.post(url, json=body or {}, headers=self.hdr(tok))

    def get(self, url, tok=None):
        return self.c.get(url, headers=self.hdr(tok))

    # ---------- 认证 ----------
    def test_01_unauthorized(self):
        r = self.get("/api/projects")
        self.assertEqual(r.status_code, 401)

    def test_02_guest_flow(self):
        r = self.post("/api/auth/guest")
        self.assertEqual(r.status_code, 200)
        d = r.get_json()
        self.assertTrue(d["user"]["is_guest"])
        self.assertRegex(d["recovery_code"], r"^GW-[0-9A-F]+$")
        self.assertEqual(self.get("/api/auth/me", d["token"]).status_code, 200)

    def test_03_register_upgrade_keeps_projects(self):
        tok = self.post("/api/auth/guest").get_json()["token"]
        pid = self.post("/api/projects", {"title": "课题A", "mode": "global"}, tok).get_json()["id"]
        r = self.post("/api/auth/register",
                      {"username": "teacher1", "password": "123456", "guest_token": tok})
        self.assertEqual(r.status_code, 200)
        ut = r.get_json()["token"]
        projects = self.get("/api/projects", ut).get_json()["projects"]
        self.assertEqual([p["id"] for p in projects], [pid], "访客升级后项目应转移")

    def test_04_login_and_isolation(self):
        self.assertEqual(self.post("/api/auth/login", {"username": "teacher1", "password": "bad"}).status_code, 400)
        ut = self.post("/api/auth/login", {"username": "teacher1", "password": "123456"}).get_json()["token"]
        self.assertFalse(self.get("/api/auth/me", ut).get_json()["user"]["is_guest"])
        # 新访客不可见他人项目
        gt = self.post("/api/auth/guest").get_json()["token"]
        self.assertEqual(self.get("/api/projects", gt).get_json()["projects"], [])

    def test_05_recovery_code(self):
        d = self.post("/api/auth/guest").get_json()
        r = self.post("/api/auth/guest/resume", {"code": d["recovery_code"]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.post("/api/auth/guest/resume", {"code": "GW-XXXXXX"}).status_code, 400)

    def test_06_recovery_invalid_after_upgrade(self):
        d = self.post("/api/auth/guest").get_json()
        self.post("/api/projects", {"title": "t", "mode": "global"}, d["token"])
        self.post("/api/auth/register", {"username": "teacher2", "password": "123456", "guest_token": d["token"]})
        r = self.post("/api/auth/guest/resume", {"code": d["recovery_code"]})
        self.assertEqual(r.status_code, 400, "升级后旧恢复码应失效")

    # ---------- 项目与对话 ----------
    def test_10_project_crud_and_stream(self):
        tok = self.post("/api/auth/guest").get_json()["token"]
        pid = self.post("/api/projects", {"title": "海洋空间资源开发与国家安全", "mode": "global"}, tok).get_json()["id"]
        self.assertEqual(self.post(f"/api/projects/{pid}/messages", {"content": "开始"}, tok).status_code, 200)
        # SSE 流（demo 模式，TESTING 下无逐字延时）
        r = self.get(f"/api/projects/{pid}/stream?token={tok}")
        self.assertEqual(r.status_code, 200)
        body = b"".join(r.response).decode() if hasattr(r, "response") else r.get_data(as_text=True)
        self.assertIn("data:", body)
        # 回复已落库且进度已回写
        d = self.get(f"/api/projects/{pid}", tok).get_json()
        self.assertEqual(d["project"]["current_node"], "N1")
        self.assertTrue(any(m["role"] == "assistant" and "课题解析" in m["content"] for m in d["messages"]))
        # 他人项目不可见
        self.assertEqual(self.get(f"/api/projects/{pid}", self.post("/api/auth/guest").get_json()["token"]).status_code, 404)

    def test_11_mode_switch_handoff(self):
        tok = self.post("/api/auth/guest").get_json()["token"]
        pid = self.post("/api/projects", {"title": "课题B", "mode": "global"}, tok).get_json()["id"]
        self.post(f"/api/projects/{pid}/messages", {"content": "go"}, tok)
        self.get(f"/api/projects/{pid}/stream?token={tok}")
        r = self.post(f"/api/projects/{pid}/switch", {"to": "theme"}, tok)
        self.assertEqual(r.status_code, 200)
        h = r.get_json()["handoff"]
        self.assertIn("模式切换", h)
        self.assertIn("课题B", h)
        self.assertEqual(self.get(f"/api/projects/{pid}", tok).get_json()["project"]["mode"], "theme")
        self.assertEqual(self.post(f"/api/projects/{pid}/switch", {"to": "bad"}, tok).status_code, 400)

    def test_12_export_zip_pieces(self):
        tok = self.post("/api/auth/guest").get_json()["token"]
        pid = self.post("/api/projects", {"title": "课题C", "mode": "global"}, tok).get_json()["id"]
        self.post(f"/api/projects/{pid}/messages", {"content": "go"}, tok)
        for _ in range(7):  # N0..N6 全流程
            self.get(f"/api/projects/{pid}/stream?token={tok}")
            self.post(f"/api/projects/{pid}/messages", {"content": "继续"}, tok)
            self.get(f"/api/projects/{pid}/stream?token={tok}")
        r = self.get(f"/api/projects/{pid}/export", tok)
        self.assertEqual(r.status_code, 200)
        z = zipfile.ZipFile(io.BytesIO(r.data))
        names = z.namelist()
        self.assertIn("00_对话完整记录.md", names)
        self.assertTrue(any("教学设计文档" in n for n in names), f"六件套未拆分: {names}")
        self.assertTrue(any("目标表" in n for n in names))

    def test_13_progress_extract_regex(self):
        # 中文相邻环境下节点提取正则的回归（曾因\b失效）
        self.assertEqual(gewu._extract_node("【进度：N0已完成｜待办：N1议题选择】"), "N1")
        self.assertEqual(gewu._extract_node("【进度：M1已完成｜M2已完成｜M5已完成｜已交付】"), "M5")


if __name__ == "__main__":
    unittest.main(verbosity=2)
