# -*- coding: utf-8 -*-
"""「格物」V2.5 本地运行版后端
Flask + SQLite + SSE 流式对话 + 方案包结构化导出 + N/M 双线互导。
仅依赖 flask / requests（纯 Python，无编译依赖）。
配置经 .env 或环境变量：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / GEWU_PORT。
未配置 API Key 时进入 demo 模式（脚本化演示响应，便于离线体验界面）。
"""
import io
import json
import os
import re
import sqlite3
import time
import zipfile

import requests
from flask import (Flask, Response, jsonify, request, send_file,
                   send_from_directory)

from engine_prompts import (GC_NODES, GC_SYSTEM, HANDOFF_TMPL, M_NODES,
                            M_SYSTEM, MODE_NAME)

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "gewu.db")

# ---------- 配置 ----------
def _load_dotenv():
    p = os.path.join(BASE, ".env")
    if os.path.isfile(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

_load_dotenv()
LLM_BASE = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com").rstrip("/")
LLM_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")
LLM_OK = bool(LLM_KEY)

app = Flask(__name__, static_folder="static", static_url_path="/static")

# ---------- 数据库 ----------
def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS projects(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'global',
          current_node TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')));
        CREATE TABLE IF NOT EXISTS messages(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now','localtime')));
        """)

init_db()

# ---------- 项目 CRUD ----------
@app.get("/")
def index():
    return send_from_directory("static", "index.html")

@app.get("/api/health")
def health():
    return jsonify({"llm": LLM_OK, "model": LLM_MODEL if LLM_OK else "demo模式（未配置Key）"})

@app.post("/api/projects")
def create_project():
    d = request.get_json(force=True)
    title = (d.get("title") or "").strip() or "未命名课题"
    mode = d["mode"] if d.get("mode") in ("global", "theme") else "global"
    with db() as c:
        cur = c.execute("INSERT INTO projects(title,mode) VALUES(?,?)", (title, mode))
        pid = cur.lastrowid
    return jsonify({"id": pid})

@app.get("/api/projects")
def list_projects():
    with db() as c:
        rows = c.execute("SELECT * FROM projects ORDER BY id DESC").fetchall()
    return jsonify({"projects": [dict(r) for r in rows]})

@app.get("/api/projects/<int:pid>")
def get_project(pid):
    with db() as c:
        p = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            return jsonify({"error": "项目不存在"}), 404
        msgs = c.execute("SELECT role,content,created_at FROM messages WHERE project_id=? ORDER BY id", (pid,)).fetchall()
    return jsonify({"project": dict(p), "messages": [dict(m) for m in msgs]})

@app.delete("/api/projects/<int:pid>")
def del_project(pid):
    with db() as c:
        c.execute("DELETE FROM messages WHERE project_id=?", (pid,))
        c.execute("DELETE FROM projects WHERE id=?", (pid,))
    return jsonify({"ok": True})

# ---------- 对话 ----------
@app.post("/api/projects/<int:pid>/messages")
def add_message(pid):
    d = request.get_json(force=True)
    content = (d.get("content") or "").strip()
    if not content:
        return jsonify({"error": "空消息"}), 400
    with db() as c:
        c.execute("INSERT INTO messages(project_id,role,content) VALUES(?, 'user', ?)", (pid, content))
    return jsonify({"ok": True})

def _history(pid):
    with db() as c:
        p = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        msgs = c.execute("SELECT role,content FROM messages WHERE project_id=? ORDER BY id", (pid,)).fetchall()
    return (dict(p) if p else None), [dict(m) for m in msgs]

@app.get("/api/projects/<int:pid>/stream")
def stream(pid):
    p, msgs = _history(pid)
    if not p:
        return jsonify({"error": "项目不存在"}), 404
    system = GC_SYSTEM if p["mode"] == "global" else M_SYSTEM

    def gen():
        acc = []
        persisted = {"done": False}

        def persist():
            if persisted["done"]:
                return
            full = "".join(acc)
            if full:
                node = _extract_node(full)
                with db() as c:
                    c.execute("INSERT INTO messages(project_id,role,content) VALUES(?, 'assistant', ?)", (pid, full))
                    if node:
                        c.execute("UPDATE projects SET current_node=? WHERE id=?", (node, pid))
            persisted["done"] = True

        try:
            if LLM_OK:
                url = LLM_BASE + "/chat/completions"
                payload = {"model": LLM_MODEL, "stream": True, "temperature": 0.6,
                           "messages": [{"role": "system", "content": system}] +
                                       [{"role": m["role"], "content": m["content"]} for m in msgs]}
                r = requests.post(url, json=payload, stream=True, timeout=300,
                                  headers={"Authorization": f"Bearer {LLM_KEY}",
                                           "Content-Type": "application/json"})
                r.raise_for_status()
                for raw in r.iter_lines(decode_unicode=True):
                    if not raw or not raw.startswith("data:"):
                        continue
                    data = raw[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        delta = json.loads(data)["choices"][0]["delta"].get("content") or ""
                    except Exception:
                        continue
                    if delta:
                        acc.append(delta)
                        yield f"data: {json.dumps({'delta': delta}, ensure_ascii=False)}\n\n"
            else:
                # demo 模式：脚本化响应，按节点推进
                text = _demo_reply(p, msgs)
                acc.append(text)
                for chunk in text:
                    yield f"data: {json.dumps({'delta': chunk}, ensure_ascii=False)}\n\n"
                    time.sleep(0.004)
            persist()
            yield "data: [DONE]\n\n"
        except Exception as e:  # 网络异常时保留已生成部分
            persist()
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        finally:
            persist()  # 客户端提前断开（GeneratorExit）也落库已生成部分

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

NODE_RE = re.compile(r"【进度[:：].*?】")

def _extract_node(text):
    m = NODE_RE.search(text)
    if not m:
        return ""
    # 注意：中文环境下不能用\b（汉字属\w），改用负向断言
    ids = re.findall(r"([NM]\d)(?![0-9A-Za-z])", m.group(0))
    return ids[-1] if ids else ""

# ---------- demo 模式脚本化响应 ----------
_DEMO_GC = {
"N0": "🧭 **N0 ｜ 课题解析卡**\n\n**课标定位**：【待核】选必3 资源、环境与国家安全模块（请按课标原文核对条目）。\n**素养映射**：区域认知·强｜综合思维·强｜人地协调观·中｜地理实践力·中。\n**适配度**：知识·高｜技能·高｜态度·高｜价值观·高 → 推荐实施。\n\n【依据】课题与真实全球议题存在稳定联系。\n\n【进度：N0已完成｜待办：N1议题选择】",
"N1": "🧭 **N1 ｜ 议题评分矩阵（3选1）**\n\n| 议题 | 跨学科 | 驱动性问题 | 复杂度 | GC侧重 |\n|---|---|---|---|---|\n| A 冲突型 | 地理+政治 | 主张之外还能怎样解决？ | 中 | 态度·价值观 |\n| B 决策型 | 地理+生物 | 每一平方米的收益与代价？ | 中 | 知识·技能 |\n| C 协作型 | 地理+经济 | 存在各方都接受的方案吗？ | 高 | 技能·价值观 |\n\n【建议】推荐议题A，冲突情境最能激发态度维度学习；最终由您选择。\n\n【进度：N1已完成｜待办：N2目标分层】",
"N2": "🧭 **N2 ｜ SOLO分层目标表**\n\n| 编号 | 层级 | 目标 | GC维度 |\n|---|---|---|---|\n| G1 | 单点 | 依据资料**识别**…类型，**说出**…两处 | 知识 |\n| G2 | 多点 | **分析**…三个维度的关联，各一条证据 | 知识 |\n| G3 | 多点 | **比较**不同立场诉求，**区分**事实与价值主张 | 技能·态度 |\n| G4 | 关联 | **综合**三科证据**解释**己方立场并回应质询 | 技能 |\n| G5 | 拓展 | **设计**可持续方案并**论证**可行性 | 价值观 |\n\n【学情假设】默认多数学生处于多点结构层，请以真实学情校正。\n\n【进度：N2已完成｜待办：N3评价设计】",
"N3": "🧭 **N3 ｜ 表现性评价量规与一致性校验**\n\n| 目标 | 证据 | 时机 | 主体 |\n|---|---|---|---|\n| G1-G2 | 分析单 | 环节2 | 师评+AI辅助 |\n| G3-G4 | 发言记录 | 环节4 | AI记录+师评 |\n| G5 | 方案文本 | 环节6 | 量规四维（师评60%+互评40%） |\n\n三向一致性校验：✓ 通过。\n\n【进度：N3已完成｜待办：N4资源生成】",
"N4": "🧭 **N4 ｜ 分层匹配资源包**\n\n| 编号 | 资源 | 对应目标 | 标注 |\n|---|---|---|---|\n| R1 | 多视角案例组×3 | G3/G4 | 【依据】官方立场文件 |\n| R2 | 数据表框架 | G2/G5 | 【待核】数值待填充 |\n| R3 | 可视化代码 | G2 | matplotlib 框架 |\n\n\n【进度：N4已完成｜待办：N5实训设计】",
"N5": "🧭 **N5 ｜ 实训设计方案**\n\n四组多边论坛（12分钟）：角色卡×4（立场互异）、冲突事件×2、导师/伴学智能体提示词各一段（可部署）。\n【建议】涉及领土议题，角色立场表述须教师课前审定。\n\n【进度：N5已完成｜待办：N6整合输出】",
"N6": "🧭 **N6 ｜ 教学设计方案包（六件套）**\n\n### 第1件：六环节教学设计文档\n| 环节 | 时间 | 活动 | 目标 |\n|---|---|---|---|\n| 1 议题导入 | 5' | 地图对比聚焦问题 | G1 |\n| 2 资源研读 | 8' | 三视角案例研读 | G2 |\n| 3 分层任务 | 7' | SOLO分层推进 | G3 |\n| 4 场景实训 | 12' | 多边论坛 | G4 |\n| 5 成果推演 | 8' | 方案起草 | G5 |\n| 6 逆向评价 | 5' | 量规互评修订 | G5 |\n\n### 第2件：SOLO分层目标表\n见 N2 产出（版本1.0）。\n\n### 第3件：评价量规与数据采集点\n见 N3 产出。\n\n### 第4件：跨学科资源包清单\n见 N4 产出（教师筛选后）。\n\n### 第5件：实训脚本\n见 N5 产出（含三段可部署提示词）。\n\n### 第6件：课堂智能体配置说明\n准备 AI 入口→粘贴角色卡→课中按组切换；导师端输入对话记录生成报告。\n\n一致性终检：✓ 全部对齐。⟲ 课后可回传学生表现，优化下一轮目标。\n\n【进度：N0已完成｜N1已完成｜N2已完成｜N3已完成｜N4已完成｜N5已完成｜N6已完成｜方案包已交付】",
}
_DEMO_M = {
"M1": "🧭 **M1 ｜ 课标分析单**\n\n【待核】内容要求定位（请核对课标原文）；学业质量水平对应描述。\n**学科关联矩阵**：历史·强（沿革证据）｜政治·中（法规）｜生物·中（生态证据）→ 建议协同学科：历史+政治。\n\n【进度：M1已完成｜待办：M2教材分析】",
"M2": "🧭 **M2 ｜ 教材取舍决策表**\n\n| 章节 | 取舍 | 理由 |\n|---|---|---|\n| 前置概念 | 主题必选 | 奠定概念基础 |\n| 案例活动 | 主题支撑 | 改造为主题情境 |\n| 拓展阅读 | 暂舍 | 超出课时容量 |\n\n【建议】取舍可按学情再调。\n\n【进度：M1已完成｜M2已完成｜待办：M3主题建构】",
"M3": "🧭 **M3 ｜ 主题四核设计单**\n\n- **核心内容**：概念·结构·关系\n- **核心目标**：1个目标＋进阶表现（SOLO动词表述）\n- **核心问题**：需凭地理证据回答\n- **核心任务**：真实情境·可观察证据\n\n**目标↔证据对齐表**（强制）：\n| 目标/进阶 | 学生证据 | 采集时机 |\n|---|---|---|\n| 核心目标+表现1 | 任务单完成度 | 环节中段 |\n| 进阶表现2 | 成果物+答辩 | 结课 |\n\n跨学科理解目标×1（整合地理+历史）。\n\n【进度：M1已完成｜M2已完成｜M3已完成｜待办：M4工具实践】",
"M4": "🧭 **M4 ｜ 工具与实践设计单**\n\n学科资源组：地理（数据表【待核】）/历史（沿革材料）/政治（法规节选【依据】）；AIGC使用点：资料整理、情境创设、分层提示（均需教师审核）；实践工具：GIS图层+Python可视化。\n\n【进度：M1-M3已完成｜M4已完成｜待办：M5课件精化】",
"M5": "🧭 **M5 ｜ 课件问题链方案（五件套收束）**\n\n**问题链**：导入问题→递进问题×2→核心问题→迁移问题（逐条标注四核与SOLO层级）。\n**任务单要点**+**课件结构**（页序+每页问题）。\n评价采集点与M3对齐表逐项核对：✓。\n\n⟲ 依课件实施反馈修订四核与问题链。\n\n【进度：M1已完成｜M2已完成｜M3已完成｜M4已完成｜M5已完成｜问题链＋五件套已交付】",
}

def _demo_reply(p, msgs):
    mode = p["mode"]
    table = _DEMO_GC if mode == "global" else _DEMO_M
    cur = (p["current_node"] or "").strip()
    prefix = "（demo 模式：未配置 LLM_API_KEY，以下为脚本化演示。在 .env 填入 Key 即为真实生成。）\n\n"
    if cur in table:
        return table[cur]
    first = table["N0"] if mode == "global" else table["M1"]
    return prefix + first

# ---------- 模式互导（完善建议#4） ----------
@app.post("/api/projects/<int:pid>/switch")
def switch_mode(pid):
    d = request.get_json(force=True)
    to = d.get("to")
    if to not in ("global", "theme"):
        return jsonify({"error": "目标模式不合法"}), 400
    p, msgs = _history(pid)
    last_assistant = next((m["content"] for m in reversed(msgs) if m["role"] == "assistant"), "")
    summary = last_assistant[:400]
    node = p["current_node"] or "（尚无进度）"
    handoff = HANDOFF_TMPL.format(frm=MODE_NAME[p["mode"]], to=MODE_NAME[to],
                                  title=p["title"], node=node, summary=summary)
    with db() as c:
        c.execute("UPDATE projects SET mode=? WHERE id=?", (to, pid))
        c.execute("INSERT INTO messages(project_id,role,content) VALUES(?, 'user', ?)", (pid, handoff))
    return jsonify({"ok": True, "handoff": handoff})

# ---------- 方案包结构化导出（完善建议#6） ----------
_PIECE_KEYS = ["教学设计文档", "分层目标表", "评价量规", "资源包", "实训脚本",
               "课堂智能体配置", "课标分析单", "教材分析", "四核设计单",
               "工具与实践设计单", "问题链"]
_HEAD_RE = re.compile(r"^(#{2,4})\s*第([一二三四五六1-6])件[：:]?\s*(.*)$|^#{2,4}\s*(.+)$", re.M)

@app.get("/api/projects/<int:pid>/export")
def export_package(pid):
    p, msgs = _history(pid)
    pieces = {}

    def feed(text):
        cur = None
        buf = []
        for line in text.splitlines():
            m = re.match(r"^#{2,4}\s*第[一二三四五六1-6]件[：:]?\s*(.*)$", line)
            m2 = re.match(r"^#{2,4}\s*(.+)$", line)
            if m:
                if cur:
                    pieces.setdefault(cur, []).append("\n".join(buf))
                cur, buf = m.group(1).strip() or f"第{m.group(2)}件", []
            elif m2 and any(k in (m2.group(1) or "") for k in _PIECE_KEYS):
                if cur:
                    pieces.setdefault(cur, []).append("\n".join(buf))
                cur, buf = m2.group(1).strip(), []
            elif cur is not None:
                buf.append(line)
        if cur:
            pieces.setdefault(cur, []).append("\n".join(buf))

    for m in msgs:
        if m["role"] == "assistant":
            feed(m["content"])

    bufio = io.BytesIO()
    with zipfile.ZipFile(bufio, "w", zipfile.ZIP_DEFLATED) as z:
        if not pieces:
            full = "\n\n---\n\n".join(m["content"] for m in msgs if m["role"] == "assistant")
            z.writestr("教学设计方案包.md", full or "（暂无产出）")
        else:
            for name, bodies in pieces.items():
                safe = re.sub(r'[\\/:*?"<>|]', "_", name)[:40]
                z.writestr(f"{safe}.md", "\n\n".join(bodies).strip())
        conv = "\n\n".join(f"**{m['role']}**：{m['content']}" for m in msgs)
        z.writestr("00_对话完整记录.md", conv)
        z.writestr("项目信息.txt", f"课题：{p['title']}\n模式：{MODE_NAME[p['mode']]}\n进度：{p['current_node']}\n导出时间：{time.strftime('%Y-%m-%d %H:%M')}\n")
    bufio.seek(0)
    fname = f"格物方案包-{p['title'][:20]}.zip"
    return send_file(bufio, as_attachment=True, download_name=fname, mimetype="application/zip")

if __name__ == "__main__":
    port = int(os.environ.get("GEWU_PORT", "5010"))
    print(f"「格物」V2.5 已启动: http://127.0.0.1:{port}  |  LLM: {LLM_MODEL if LLM_OK else 'demo模式'}")
    app.run(host="127.0.0.1", port=port, threaded=True)
