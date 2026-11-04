# 「格物」V2.7 本地运行版

> 「格物」智能体矩阵的开源参考实现：Flask + SQLite + SSE 的完整可运行应用。
> 对应《08_技术路径与设计路线》完善建议 **#4（N/M 双线互导）**、**#6（方案包结构化导出）**的代码落地，
> 并**完整复刻线上部署版的账号体系架构**（访客/注册/恢复码/访客升级）与**核心可视化**（四核面板/SOLO速查/⟲闭环条）；N 线 / M 线引擎提示词、统一进度行协议、四级徽章协议均已内置。

## 功能

- **账号体系（V2.6）**：访客一键进入（免注册）· 注册/登录 · 访客恢复码换设备找回 · 访客升级为正式账号并保留全部项目 · 项目按用户隔离
- **双模式设计主线**：🌍 全球胜任力（N0–N6，六件套）｜🧩 跨学科主题学习（M1–M5，问题链＋五件套）
- **可视化看板（V2.7，对齐部署版）**：节点进度流（【进度】行+🧭标题双通道解析）；M线**四核设计链路面板**（M1→核心内容点亮，M3→目标/问题/任务点亮）；**SOLO四级行为动词速查**（常驻折叠面板）；**⟲闭环提示条**专用样式
- **四级徽章渲染**：【依据】绿 /【待核】红 /【建议】蓝 /【学情假设】黄
- **N/M 双线互导**：一键切换模式，自动携带课题、原流程进度与产出摘要的"承接要点"
- **方案包结构化导出**：N6/M5 产出的"第X件/单据"自动拆分为独立 md 文件，打包 zip
- **性能与健壮性（V2.7）**：SSE 渲染 120ms 节流；SQLite WAL 模式 + 连接即用即关（修连接泄漏）；回归测试套件 10 项全绿
- **快捷课题**：登录页后一键填入示例课题
- **demo 模式**：未配置 API Key 时以脚本化演示运行，离线体验全部交互

## 快速开始

```bash
cd gewu-app
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 方式一：demo 模式（无需任何配置）
python app.py

# 方式二：接入真实大模型（OpenAI 兼容接口均可）
copy .env.example .env    # 填入 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
python app.py

# 运行回归测试（独立临时库，不影响运行数据）
python -m unittest tests.test_api -v
```

浏览器访问 **http://127.0.0.1:5010** → 访客进入或注册 → 新建项目 → 选择模式 → 输入课题 → 逐节点推进。

## 目录结构

```
gewu-app/
├── app.py              # Flask 后端：认证端点族、项目/消息 CRUD、SSE 流式对话、互导、导出
├── auth.py             # 认证模块：PBKDF2密码 + HMAC签名token + 访客/恢复码（纯标准库）
├── engine_prompts.py   # 引擎提示词：N线/M线系统提示词 + 互导协议模板
├── static/
│   ├── index.html      # 主应用单页
│   ├── login.html      # 登录页（访客进入/登录/注册/恢复码找回）
│   ├── app.js          # token守卫/节点流/四核面板/SOLO速查/徽章/SSE节流/互导/导出
│   └── style.css
├── tests/test_api.py   # 回归测试套件（unittest，10项：认证/项目/对话/互导/导出）
├── requirements.txt
├── .env.example
└── gewu.db             # 运行时自动创建（SQLite, WAL模式）
```

## API 一览

| 端点 | 说明 |
|---|---|
| `POST /api/auth/guest` | 访客一键进入（返回 token + 恢复码） |
| `POST /api/auth/guest/resume` | 恢复码找回（换设备找回访客数据） |
| `POST /api/auth/register` | 注册（可带 guest_token，访客升级保留项目） |
| `POST /api/auth/login` | 登录 |
| `GET /api/auth/me` | 当前用户信息（token 校验） |
| `POST /api/auth/logout` | 退出（客户端清除凭据） |
| `POST /api/projects` | 建项目（title, mode=global/theme） |
| `GET /api/projects/<id>` | 项目详情+全部消息 |
| `POST /api/projects/<id>/messages` | 追加用户消息 |
| `GET /api/projects/<id>/stream` | SSE 流式生成（真实 LLM 或 demo；支持 ?token= 供 EventSource） |
| `POST /api/projects/<id>/switch` | 模式互导（to=global/theme，自动携带摘要） |
| `GET /api/projects/<id>/export` | 方案包 zip 导出（六件套/五件套拆分） |

认证方式：`Authorization: Bearer <token>`（SSE 端点另支持 `?token=`）；未认证一律 401，前端自动跳转登录页。与线上部署版共用 `jw_token` / `jw_user` 本地存储键名。

## 与部署版的关系

本实现与线上扣子部署版共用同一套协议（【进度】行、【模式】标签、四级徽章），可直接作为：
1. 部署版的**参考实现与备援**（数据自有、模型自选）；
2. 新变体的**开发底座**（在 engine_prompts.py 增加内核包即可扩展，如主题式教学设计）；
3. V3 课堂端"导学伴"的**接入基座**（stream 端点即 Agent 接口）。
