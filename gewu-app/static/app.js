/* 「格物」V2.5 前端逻辑：项目管理 / 双模式节点流 / 徽章渲染 / SSE流式 / 方案包导出 / 模式互导 */
"use strict";

const NODES = {
  global: [["N0","课题解析"],["N1","议题选择"],["N2","目标分层"],["N3","评价设计"],["N4","资源生成"],["N5","实训设计"],["N6","整合输出"]],
  theme:  [["M1","课标解析"],["M2","教材分析"],["M3","主题建构"],["M4","工具实践"],["M5","课件精化"]],
};
const MODE_NAME = { global: "🌍 全球胜任力", theme: "🧩 跨学科主题学习" };
const TOKEN_KEY = "jw_token", USER_KEY = "jw_user";

/* M线四核设计链路（点亮规则对齐部署版：M1→核心内容，M3→目标/问题/任务） */
const THEME_CORES = [
  { id: "tc-0", name: "核心内容", desc: "概念·结构·关系", litAt: "M1" },
  { id: "tc-1", name: "核心目标", desc: "1个目标＋进阶表现", litAt: "M3" },
  { id: "tc-2", name: "核心问题", desc: "需凭地理证据回答", litAt: "M3" },
  { id: "tc-3", name: "核心任务", desc: "真实情境·可观察证据", litAt: "M3" },
];
/* SOLO四级行为动词白名单（常驻速查） */
const SOLO_TIERS = [
  ["单点结构", "识别 · 说出 · 描述 · 列举 · 指认"],
  ["多点结构", "分析 · 比较 · 说明 · 归纳 · 区分"],
  ["关联结构", "综合 · 解释 · 评价 · 论证 · 整合"],
  ["抽象拓展", "设计 · 创造 · 建构 · 提出方案 · 决策"],
];
const $ = (id) => document.getElementById(id);

/* ---------- 鉴权 ---------- */
function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
function authHeaders() { return { "Authorization": "Bearer " + token() }; }
function clearAuth() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
function gotoLogin() { location.href = "/ui/login.html"; }

async function api(url, opts = {}) {
  const resp = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers || {}) } });
  if (resp.status === 401) { clearAuth(); gotoLogin(); throw new Error("登录已失效"); }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "请求失败");
  return data;
}

/* ---------- Toast ---------- */
function toast(msg, type = "") {
  const box = $("toastBox");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- 智能滚动：仅在贴近底部时自动跟随，滚上去看历史时不打扰 ---------- */
function nearBottom() {
  const c = $("chat");
  return c.scrollHeight - c.scrollTop - c.clientHeight < 90;
}
function scrollBottom(force) {
  if (force || nearBottom()) $("chat").scrollTop = $("chat").scrollHeight;
}

/* ---------- 吉样物「格物」· 状态感知气泡 ---------- */
const MASCOT_TIPS = [
  "小贴士：目标要用 SOLO 白名单动词写——「识别、说出」是单点层，「设计方案」是拓展层 📐",
  "小贴士：【依据】【待核】【建议】【学情假设】四种徽章，标红【待核】的内容课前一定要核实哦 🔍",
  "小贴士：一条设计主线走不完？右上角「⇄ 切换模式」可携带进度与摘要换线续作 ✨",
  "小贴士：每完成一个环节，上方的节点流会自动点亮，随时知道走到哪一步了 🧭",
  "小贴士：M 线的核心目标讲究「1个目标＋进阶表现」，进阶表现要能观察到学生证据 🎯",
  "小贴士：N 线走到 N6 会生成六件套方案包，点右上「📦 导出」即可按件拆分下载 📦",
  "小贴士：换设备也不怕——登录页用访客恢复码可以找回之前的备课进度 🔑",
];
let mascotTimer = null;
function mascotSay(text, opts = {}) {
  const box = $("mascotBubble"), el = $("mascotText"), m = $("mascot");
  clearTimeout(mascotTimer);
  box.classList.remove("hidden");
  el.textContent = text;
  m.classList.toggle("thinking", !!opts.thinking);
  if (opts.thinking) {
    el.innerHTML = text + ' <span class="typing-dots"><i></i><i></i><i></i></span>';
  }
  if (!opts.sticky && !opts.thinking) {
    mascotTimer = setTimeout(() => box.classList.add("hidden"), opts.hold || 6000);
  }
}
function mascotQuiet() {
  clearTimeout(mascotTimer);
  $("mascotBubble").classList.add("hidden");
  $("mascot").classList.remove("thinking");
}

/* ---------- 吉样物拖拽：指针拖动 / 视口边界钳制 / 位置记忆 / 与点击区分 ---------- */
let mascotJustDragged = false;
function initMascotDrag() {
  const el = $("mascot");
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false, activePid = null;

  // 恢复上次摆放位置（换会话延续）
  try {
    const lx = parseFloat(localStorage.getItem("mascot_x"));
    const ly = parseFloat(localStorage.getItem("mascot_y"));
    if (!isNaN(lx) && !isNaN(ly)) {
      const r = el.getBoundingClientRect();
      const cx = Math.min(Math.max(lx, 8), innerWidth - r.width - 8);
      const cy = Math.min(Math.max(ly, 8), innerHeight - r.height - 8);
      el.style.left = cx + "px";
      el.style.top = cy + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    }
  } catch (_) {}

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    activePid = e.pointerId;
    sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect();
    ox = r.left; oy = r.top;
    moved = false; dragging = false;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });
  el.addEventListener("pointermove", (e) => {
    if (activePid === null || e.pointerId !== activePid) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) > 6) {
      moved = true; dragging = true;
      el.classList.add("dragging");
      el.style.right = "auto"; el.style.bottom = "auto";
      $("mascotBubble").classList.add("hidden"); // 拖动时收起气泡
    }
    if (dragging) {
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = Math.min(Math.max(ox + dx, 8), innerWidth - w - 8) + "px";
      el.style.top = Math.min(Math.max(oy + dy, 8), innerHeight - h - 8) + "px";
    }
  });
  const end = (e) => {
    if (activePid === null || e.pointerId !== activePid) return;
    activePid = null;
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (dragging) {
      el.classList.remove("dragging");
      mascotJustDragged = true;
      setTimeout(() => (mascotJustDragged = false), 50);
      try {
        localStorage.setItem("mascot_x", el.style.left);
        localStorage.setItem("mascot_y", el.style.top);
      } catch (_) {}
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  // 视口尺寸变化时把吉样物钳回屏幕内（如旋转屏幕、缩放窗口）
  window.addEventListener("resize", () => {
    if (el.style.left === "") return;  // 仍在默认位（right/bottom 定位）则无需处理
    const r = el.getBoundingClientRect();
    if (r.left < 8 || r.top < 8 || r.right > innerWidth - 8 || r.bottom > innerHeight - 8) {
      el.style.left = Math.min(Math.max(r.left, 8), Math.max(8, innerWidth - r.width - 8)) + "px";
      el.style.top = Math.min(Math.max(r.top, 8), Math.max(8, innerHeight - r.height - 8)) + "px";
      try {
        localStorage.setItem("mascot_x", el.style.left);
        localStorage.setItem("mascot_y", el.style.top);
      } catch (_) {}
    }
  });
}

let projects = [];
let current = null;   // {id,title,mode,current_node}
let streaming = false;
let es = null;

/* ---------- 主题（暗色/亮色）：记忆手动选择，默认跟随系统 ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("btnTheme").textContent = t === "dark" ? "☀️ 亮色" : "🌙 暗色";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === "dark" ? "#0B141D" : "#0E2740";
}

/* ---------- 初始化 ---------- */
async function init() {
  if (!token()) { gotoLogin(); return; }
  const saved = localStorage.getItem("gewu_theme");
  applyTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("btnTheme").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("gewu_theme", next);
    applyTheme(next);
  };
  let me;
  try { me = await api("/api/auth/me"); }
  catch (_) { return; }  // 401 已跳转登录页
  const u = me.user || {};
  $("userChip").classList.remove("hidden");
  $("userChip").textContent = u.is_guest ? `${u.username} · 访客` : u.username;
  $("btnLogout").classList.remove("hidden");
  $("btnLogout").onclick = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (_) {}
    clearAuth(); gotoLogin();
  };

  const h = await (await fetch("/api/health")).json();
  $("llmState").textContent = h.llm ? `引擎：${h.model}` : "引擎：demo 模式（未配Key）";
  // SOLO 速查：情境化弹出层（输入区旁调出，撰写目标时随手可查）
  $("soloTable").innerHTML = SOLO_TIERS.map(([lv, vv]) =>
    `<div class="solo-row"><span class="lv"></span><span class="vv"></span></div>`).join("");
  document.querySelectorAll("#soloTable .solo-row").forEach((row, i) => {
    row.querySelector(".lv").textContent = SOLO_TIERS[i][0];
    row.querySelector(".vv").textContent = SOLO_TIERS[i][1];
  });
  $("btnSolo").onclick = () => $("soloPop").classList.toggle("hidden");
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#soloPop") && !e.target.closest("#btnSolo")) {
      $("soloPop").classList.add("hidden");
    }
  });
  await loadProjects();
  renderShell();  // 初始渲染（快捷课题chip、SOLO面板等）
  $("btnNew").onclick = () => $("modalNew").classList.remove("hidden");
  $("npCancel").onclick = () => $("modalNew").classList.add("hidden");
  $("npCreate").onclick = createProject;
  $("btnSend").onclick = send;
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("btnMenu").onclick = () => {
    const open = $("sidebar").classList.toggle("open");
    $("scrim").classList.toggle("hidden", !open);  // 移动端抽屉遮罩
  };
  $("scrim").onclick = () => {
    $("sidebar").classList.remove("open");
    $("scrim").classList.add("hidden");
  };
  $("btnExport").onclick = () => {
    if (!current) return;
    mascotSay("zip 开始下载：方案按件拆分为 md + Word 文档，附完整对话记录 📦");
    window.open(`/api/projects/${current.id}/export?token=${encodeURIComponent(token())}`);
  };
  // 课后学情反馈（闭环）
  $("btnFeedback").onclick = () => {
    if (!current || streaming) return;
    $("fbText").value = "";
    $("modalFeedback").classList.remove("hidden");
    $("fbText").focus();
  };
  $("fbCancel").onclick = () => $("modalFeedback").classList.add("hidden");
  $("fbSubmit").onclick = async () => {
    const text = $("fbText").value.trim();
    if (text.length < 15) { toast("请粘贴更完整的学生表现材料（至少15字）"); return; }
    $("modalFeedback").classList.add("hidden");
    addMessage("user", "【课后反馈】" + text + ($("fbIncludeGoals").checked ? "" : "\n（教师选择不附带对话上下文）"));
    await api(`/api/projects/${current.id}/messages`, {
      method: "POST", body: JSON.stringify({ content: "【课后反馈】" + text + ($("fbIncludeGoals").checked ? "" : "\n（教师选择不附带对话上下文）") }),
    });
    streamOnce();
  };
  // 数据备份
  $("btnBackup").onclick = () => window.open(`/api/backup?token=${encodeURIComponent(token())}`);
  $("btnSwitch").onclick = switchMode;
  // 输入框自动增高
  $("input").addEventListener("input", () => {
    const el = $("input");
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  });
  // 滚动到底FAB
  $("chat").addEventListener("scroll", () => {
    $("scrollFab").classList.toggle("show", !nearBottom());
  });
  $("scrollFab").onclick = () => scrollBottom(true);
  // 吉样物：问候 + 点击掉落小贴士（拖动后不误触发）
  $("mascot").onclick = () => {
    if (mascotJustDragged) return;
    mascotSay(MASCOT_TIPS[Math.floor(Math.random() * MASCOT_TIPS.length)], { hold: 8000 });
  };
  initMascotDrag();
  setTimeout(() => mascotSay("你好，我是格物 🌏 新建一个项目，或点下面的示例课题开始设计吧！", { hold: 9000 }), 900);

  // 键盘快捷键：/ 聚焦输入框（未处于输入态时）、Esc 关闭弹层、Ctrl+Enter 发送
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      ["modalNew", "modalRename", "modalFeedback"].forEach(id => $(id).classList.add("hidden"));
      $("soloPop").classList.add("hidden");
      $("mascotBubble").classList.add("hidden");
      return;
    }
    const inField = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "/" && !inField && current) {
      e.preventDefault();
      $("input").focus();
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && document.activeElement === $("input")) {
      e.preventDefault();
      send();
    }
  });

  // LLM 引擎连通性测试（点击侧栏引擎状态）
  $("llmState").style.cursor = "pointer";
  $("llmState").title = "点击测试大模型连通性";
  $("llmState").onclick = async () => {
    toast("正在测试引擎连通性…");
    try {
      const d = await (await fetch("/api/llm-test")).json();
      if (d.ok) toast(`✓ 引擎连通：${d.model}（${d.ms}ms）`, "ok");
      else toast(`✗ ${d.error}`, "");
    } catch (_) { toast("✗ 测试请求失败", ""); }
  };

  // 多标签页同步：其它标签页的项目变更广播到本页
  window.addEventListener("storage", (e) => {
    if (e.key === "gewu_bump") loadProjects().catch(() => {});
  });
  const origLoad = loadProjects;
  loadProjects = async function () {  // 变更后广播给其它标签页
    localStorage.setItem("gewu_bump", String(Date.now()));
    return origLoad();
  };
}

async function loadProjects() {
  const d = await api("/api/projects");
  projects = d.projects || [];
  const box = $("projectList");
  box.innerHTML = "";
  for (const p of projects) {
    const el = document.createElement("div");
    el.className = "proj" + (current && p.id === current.id ? " active" : "");
    el.innerHTML = `<div class="t"></div><div class="m"><span class="mb"></span><span class="nd"></span>
      <span class="ops"><button class="rn" title="重命名">✎</button><button class="del" title="删除">✕</button></span></div>`;
    el.querySelector(".t").textContent = p.title;
    el.querySelector(".mb").textContent = MODE_NAME[p.mode] || p.mode;
    el.querySelector(".nd").textContent = p.current_node || "";
    el.querySelector(".rn").onclick = async (e) => {
      e.stopPropagation();
      openRename(p);
    };
    el.querySelector(".del").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`删除项目「${p.title}」？不可恢复。`)) return;
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      toast(`已删除「${p.title}」`, "ok");
      if (current && current.id === p.id) closeProject();
      loadProjects();
    };
    el.onclick = () => { openProject(p.id); $("sidebar").classList.remove("open"); };
    box.appendChild(el);
  }
}

/* ---------- 项目重命名 ---------- */
function openRename(p) {
  $("rnTitle").value = p.title;
  $("modalRename").classList.remove("hidden");
  $("rnTitle").focus();
  $("rnTitle").select();
  const save = async () => {
    const title = $("rnTitle").value.trim();
    if (!title || title === p.title) { $("modalRename").classList.add("hidden"); return; }
    try {
      await api(`/api/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      toast("课题已重命名", "ok");
      if (current && current.id === p.id) { current.title = title; $("projTitle").textContent = title; }
    } catch (err) { toast(err.message); }
    $("modalRename").classList.add("hidden");
    loadProjects();
  };
  $("rnSave").onclick = save;
  $("rnTitle").onkeydown = (e) => { if (e.key === "Enter") save(); };
}
$("rnCancel") && ($("rnCancel").onclick = () => $("modalRename").classList.add("hidden"));

/* ---------- 项目打开 / 新建 ---------- */
async function openProject(id) {
  const d = await api(`/api/projects/${id}`);
  current = d.project;
  renderShell();
  $("chat").innerHTML = "";
  for (const m of d.messages) addMessage(m.role, m.content, { save: false });
  refreshProgress();
  scrollBottom(true);
  const nd = current.current_node || "";
  mascotSay(nd ? `课题《${current.title}》已打开，上次进行到 ${nd}，继续推进或让我调整皆可～`
              : `课题《${current.title}》已打开，发送课题信息即可开始第一环节！`);
}

async function createProject() {
  const title = $("npTitle").value.trim() || "未命名课题";
  const mode = document.querySelector('input[name="npmode"]:checked').value;
  const d = await api("/api/projects", {
    method: "POST", body: JSON.stringify({ title, mode, seed_demo: $("npSeed").checked }),
  });
  $("modalNew").classList.add("hidden");
  $("npTitle").value = "";
  await loadProjects();
  await openProject(d.id);
  $("input").value = title;
  $("input").focus();
}

function closeProject() {
  current = null;
  $("chat").innerHTML = "";
  renderShell();
}

function renderShell() {
  const has = !!current;
  $("projTitle").textContent = has ? current.title : "选择或新建项目";
  $("modeBadge").classList.toggle("hidden", !has);
  $("btnSwitch").classList.toggle("hidden", !has);
  $("btnExport").classList.toggle("hidden", !has);
  $("btnFeedback").classList.toggle("hidden", !has);
  $("nodeFlow").classList.toggle("hidden", !has);
  $("inputBar").classList.toggle("hidden", !has);
  $("chat").classList.toggle("empty", !has);
  $("hintText").textContent = has
    ? "在下方输入课题信息或直接发送，格物将按节点推进。"
    : "新建项目并输入课题名称，格物将从第一个节点开始，逐环节生成教学设计方案。";
  $("quickChips").classList.toggle("hidden", has);
  document.querySelectorAll("#quickChips .chip").forEach(c => {
    c.onclick = () => { $("input").value = c.textContent; $("input").focus(); };
  });
  $("corePanel").classList.toggle("hidden", !has || current.mode !== "theme");
  if (has) {
    $("modeBadge").textContent = MODE_NAME[current.mode];
    renderNodes(current.mode, []);
    renderCores(new Set());
  }
}

/* ---------- 四核面板（M线） ---------- */
function renderCores(doneSet) {
  const panel = $("corePanel");
  panel.innerHTML = "";
  for (const c of THEME_CORES) {
    const el = document.createElement("div");
    const lit = doneSet && doneSet.has(c.litAt);
    el.className = "core-card" + (lit ? " on" : "");
    el.innerHTML = `<span class="tick">✓</span><b></b><small></small>`;
    el.querySelector("b").textContent = c.name;
    el.querySelector("small").textContent = c.desc;
    panel.appendChild(el);
  }
}

/* ---------- 节点流 ---------- */
function jumpToNode(id) {
  const anchors = [...document.querySelectorAll(`.msg.assistant[data-node="${id}"]`)];
  if (!anchors.length) { toast(`「${id}」的产出消息尚未生成`, ""); return; }
  const el = anchors[anchors.length - 1];
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth;  // 重启动画
  el.classList.add("flash");
}
function renderNodes(mode, doneSet) {
  const flow = $("nodeFlow");
  flow.innerHTML = "";
  const cur = current ? (current.current_node || "").trim() : "";
  const nodes = NODES[mode] || [];
  const order = nodes.findIndex(([id]) => id === cur);
  nodes.forEach(([id, name], i) => {
    const el = document.createElement("div");
    let cls = "n-node";
    if (doneSet && typeof doneSet.has === "function" && doneSet.has(id)) cls += " done";
    else if (order >= 0) {
      if (i < order) cls += " done";
      else if (i === order) cls += " active";
    }
    el.className = cls;
    el.textContent = `${id} ${name}`;
    el.title = "点击跳转到本环节产出";
    el.onclick = () => jumpToNode(id);
    flow.appendChild(el);
    if (i < nodes.length - 1) {
      const sep = document.createElement("span");
      sep.className = "n-sep";
      sep.textContent = "›";
      flow.appendChild(sep);
    }
  });
}

function parseProgress(text) {
  const m = text.match(/【进度[:：]([^】]*)】/);
  if (m) {
    return new Set([...m[1].matchAll(/([NM]\d)\s*(?:已完成|待确认)/g)].map(x => x[1]));
  }
  // 兜底：🧭 **N2/M1 ｜ 标题** → 该节点产出已呈现，视为已推进（对齐部署版）
  const t = text.match(/🧭[^\n]*?([NM]\d)\s*[｜|]/);
  if (t) return new Set([t[1]]);
  return null;
}

function refreshProgress() {
  if (!current) return;
  const bubbles = [...document.querySelectorAll(".msg.assistant .bubble")];
  const last = bubbles.length ? bubbles[bubbles.length - 1].textContent : "";
  const done = parseProgress(last);
  renderNodes(current.mode, done);
  if (current.mode === "theme") {
    $("corePanel").classList.remove("hidden");
    renderCores(done || new Set());
  } else {
    $("corePanel").classList.add("hidden");
  }
}

/* ---------- 消息渲染（轻量 Markdown + 徽章 + 进度行） ---------- */
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderMD(text) {
  let t = esc(text);
  t = t.replace(/【进度[:：][^】]*】/g, (m) => `<span class="prog-line">${m}</span>`);
  t = t.replace(/【(依据|待核|建议|学情假设)】/g, '<span class="b-$1">$1</span>');
  t = t.replace(/(⟲[^\n<]*)/g, '<span class="strategy-loop">$1</span>');
  t = t.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/^(#{1,4})\s*(.+)$/gm, (_, h, s) => `<b style="font-size:14px">${s}</b>`);
  // 表格
  const lines = t.split("\n");
  let out = [], tbl = [];
  const flush = () => {
    if (tbl.length >= 2) {
      const rows = tbl.filter(l => !/^\|[\s:|-]+\|$/.test(l));
      const cells = rows.map(r => r.split("|").slice(1, -1).map(c => c.trim()));
      let html = '<div class="tbl-wrap"><table>';
      cells.forEach((row, i) => {
        html += "<tr>" + row.map(c => `<${i === 0 ? "th" : "td"}>${c}</td>`.replace("td>", i === 0 ? "th>" : "td>")).join("") + "</tr>";
      });
      out.push(html + "</table></div>");  // 滚动容器：长表格窄屏不撑破布局
    } else if (tbl.length) out.push(tbl.join("<br>"));
    tbl = [];
  };
  for (const l of lines) {
    if (/^\s*\|.*\|\s*$/.test(l)) tbl.push(l); else { flush(); out.push(l); }
  }
  flush();
  t = out.join("\n");
  t = t.replace(/\n/g, "<br>");
  return t;
}

function addMessage(role, content, opt = {}) {
  $("chat").classList.remove("empty");
  const wrap = document.createElement("div");
  wrap.className = `msg ${role} node-anchor`;
  if (role === "assistant") {
    const m = content.match(/🧭[^\n]*?([NM]\d)\s*[｜|]/);  // 节点锚点：供节点流跳转定位
    if (m) wrap.dataset.node = m[1];
  }
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "user" ? "师" : "格";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "user") bubble.textContent = content;
  else bubble.innerHTML = renderMD(content);
  wrap.appendChild(who); wrap.appendChild(bubble);
  if (role === "assistant" && !opt.streaming) {
    const tools = document.createElement("div");
    tools.className = "tools";
    const cp = document.createElement("button");
    cp.className = "ghost"; cp.textContent = "⧉ 复制";
    cp.onclick = () => { navigator.clipboard.writeText(content); cp.textContent = "✓ 已复制"; setTimeout(() => cp.textContent = "⧉ 复制", 1500); };
    tools.appendChild(cp);
    wrap.appendChild(tools);
  }
  $("chat").appendChild(wrap);
  scrollBottom(false);
  return bubble;
}

/* ---------- 发送与 SSE ---------- */
async function send() {
  if (!current || streaming) return;
  const text = $("input").value.trim();
  if (!text) return;
  $("input").value = "";
  addMessage("user", text);
  await api(`/api/projects/${current.id}/messages`, {
    method: "POST", body: JSON.stringify({ content: text }),
  });
  streamOnce();
}

function streamOnce() {
  streaming = true;
  const btn = $("btnSend");
  btn.disabled = true;
  btn.textContent = "生成中…";
  const bubble = addMessage("assistant", "", { streaming: true });
  bubble.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
  scrollBottom(true);
  let full = "";
  // 渲染节流：流式期间高频分片只记录文本，重渲染合并到120ms一拍（对齐部署版做法）
  let dirty = false, timer = null;
  const paint = () => {
    if (!dirty) return;
    dirty = false;
    bubble.innerHTML = renderMD(full);
    scrollBottom(false);
  };
  timer = setInterval(paint, 120);
  mascotSay("正在为您设计这一环节，稍候…", { thinking: true, sticky: true });
  es = new EventSource(`/api/projects/${current.id}/stream?token=${encodeURIComponent(token())}`);
  es.onmessage = (ev) => {
    if (ev.data === "[DONE]") { es.close(); clearInterval(timer); paint(); finish(full, bubble); return; }
    try {
      const d = JSON.parse(ev.data);
      if (d.delta) { full += d.delta; dirty = true; }
      if (d.error) { full += `\n\n⚠️ ${d.error}`; dirty = true; }
    } catch (_) {}
  };
  es.onerror = () => { es.close(); clearInterval(timer); paint(); finish(full, bubble); };
}

function finish(full, bubble) {
  streaming = false;
  const btn = $("btnSend");
  btn.disabled = false;
  btn.textContent = "发送";
  if (!full) {
    bubble.closest(".msg").remove();  // 空响应不留"…"气泡
    toast("⚠️ 生成失败或连接中断，请稍后重试");
    mascotQuiet();
    return;
  }
  bubble.innerHTML = renderMD(full);
  const wrap = bubble.parentElement;
  const tools = document.createElement("div");
  tools.className = "tools";
  const cp = document.createElement("button");
  cp.className = "ghost"; cp.textContent = "⧉ 复制";
  cp.onclick = () => { navigator.clipboard.writeText(full); cp.textContent = "✓ 已复制"; setTimeout(() => cp.textContent = "⧉ 复制", 1500); };
  tools.appendChild(cp);
  wrap.appendChild(tools);
  scrollBottom(false);
  refreshProgress();
  loadProjects();
  // 吉样物反馈：完成提示 / 方案包就绪 / 学情反馈闭环
  const lastLine = full.slice(-400);
  if (/反馈已完成/.test(lastLine)) {
    mascotSay("⟲ 学情再判定完成！可基于建议开启新一轮设计——新课题或同课题进阶都可以～", { hold: 12000 });
  } else if (/已交付|全部完成|五件套已交付/.test(lastLine)) {
    mascotSay("🎉 方案包已就绪！点右上「📦 导出方案包」即可按件拆分下载；课后可点「⟲ 课后反馈」回传学情～", { hold: 12000 });
  } else {
    mascotSay("本环节完成 ✅ 请确认内容，回复「继续」进入下一环节，或告诉我要改哪里～");
  }
}

/* ---------- 模式互导 ---------- */
async function switchMode() {
  if (!current || streaming) return;
  const to = current.mode === "global" ? "theme" : "global";
  const label = MODE_NAME[to];
  if (!confirm(`将本项目切换为「${label}」模式？\n格物将携带课题与已确认产出的摘要，在新模式下继续设计。`)) return;
  const d = await api(`/api/projects/${current.id}/switch`, {
    method: "POST", body: JSON.stringify({ to }),
  });
  current.mode = to;
  $("modeBadge").textContent = MODE_NAME[to];
  renderNodes(to, null);
  $("corePanel").classList.toggle("hidden", to !== "theme");
  if (to === "theme") renderCores(new Set());
  mascotSay(`已切换到「${label}」，课题与已确认产出摘要已携带，正在为您衔接新流程…`);
  if (d.handoff) { addMessage("user", d.handoff); streamOnce(); }
  loadProjects();
}

init();
