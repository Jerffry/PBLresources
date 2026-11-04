# 「格物」V2.9 本地运行版

> 「格物」智能体矩阵的开源参考实现：Flask + SQLite + SSE 的完整可运行应用。
> N 线/M 线双引擎 + 认证体系 + 可视化看板 + 交付级双端 UI + **课后学情回流闭环（V3 第一步）**。

## 功能

- **账号体系**：访客一键进入 · 注册/登录 · 恢复码换设备找回 · 访客升级保留项目 · 项目按用户隔离
- **双模式设计主线**：🌍 全球胜任力（N0–N6，六件套）｜🧩 跨学科主题学习（M1–M5，问题链＋五件套）
- **⟲ 课后学情反馈（V2.9 新增）**：课堂实施后粘贴学生表现 → 自动切换学情分析人格 → SOLO 四级再判定（引用证据）→ 目标达成度对照 → 下一轮优化建议（目标起点/资源难度/实训脚本）——论文五步闭环"依学情反馈优化"的产品化
- **方案包导出**：md 按件拆分 + **Word 版教学设计文档** + 完整对话记录（zip）
- **可视化看板**：节点进度流（点击跳转定位）/ M线四核面板 / SOLO速查弹出层 / 四级徽章
- **数据安全**：整库备份一键下载（SQLite 一致性快照）；SSE 断流部分保留落库
- **工程与体验**：LLM 上下文裁剪（长项目token控制）· 连通性测试 · 键盘快捷键 · 多标签同步 · 吉样物（学生形象，可拖拽，状态感知）· 移动端全面适配（iOS防缩放/触屏操作/安全区）· 局域网手机访问（`GEWU_HOST=0.0.0.0`）

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
