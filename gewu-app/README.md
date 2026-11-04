# 「格物」V2.5 本地运行版

> 「格物」智能体矩阵的开源参考实现：Flask + SQLite + SSE 的完整可运行应用。
> 对应《08_技术路径与设计路线》完善建议 **#4（N/M 双线互导）** 与 **#6（方案包结构化导出）** 的代码落地；
> N 线 / M 线引擎提示词、统一进度行协议、四级徽章协议均已内置（与线上部署版协议一致）。

## 功能

- **双模式设计主线**：🌍 全球胜任力（N0–N6，六件套）｜🧩 跨学科主题学习（M1–M5，问题链＋五件套）
- **节点进度流可视化**：根据回复中的【进度】行自动点亮（已完成/进行中/待办）
- **四级徽章渲染**：【依据】绿 /【待核】红 /【建议】蓝 /【学情假设】黄
- **N/M 双线互导**：一键切换模式，自动携带课题、原流程进度与产出摘要的"承接要点"
- **方案包结构化导出**：N6/M5 产出的"第X件"自动拆分为独立 md 文件，打包 zip（含完整对话记录与项目信息）
- **项目管理**：SQLite 持久化，跨刷新续备；每条消息可复制
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
```

浏览器访问 **http://127.0.0.1:5010** ，新建项目 → 选择模式 → 输入课题 → 逐节点推进。

## 目录结构

```
gewu-app/
├── app.py              # Flask 后端：项目/消息 CRUD、SSE 流式对话、互导、导出
├── engine_prompts.py   # 引擎提示词：N线/M线系统提示词 + 互导协议模板
├── static/
│   ├── index.html      # 单页前端
│   ├── app.js          # 节点流/徽章渲染/SSE消费/模式切换/导出
│   └── style.css
├── requirements.txt
├── .env.example
└── gewu.db             # 运行时自动创建（SQLite）
```

## API 一览

| 端点 | 说明 |
|---|---|
| `POST /api/projects` | 建项目（title, mode=global/theme） |
| `GET /api/projects/<id>` | 项目详情+全部消息 |
| `POST /api/projects/<id>/messages` | 追加用户消息 |
| `GET /api/projects/<id>/stream` | SSE 流式生成（真实 LLM 或 demo） |
| `POST /api/projects/<id>/switch` | 模式互导（to=global/theme，自动携带摘要） |
| `GET /api/projects/<id>/export` | 方案包 zip 导出（六件套/五件套拆分） |

## 与部署版的关系

本实现与线上扣子部署版共用同一套协议（【进度】行、【模式】标签、四级徽章），可直接作为：
1. 部署版的**参考实现与备援**（数据自有、模型自选）；
2. 新变体的**开发底座**（在 engine_prompts.py 增加内核包即可扩展，如主题式教学设计）；
3. V3 课堂端"导学伴"的**接入基座**（stream 端点即 Agent 接口）。
