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

let projects = [];
let current = null;   // {id,title,mode,current_node}
let streaming = false;
let es = null;

/* ---------- 初始化 ---------- */
async function init() {
  if (!token()) { gotoLogin(); return; }
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
  // SOLO 速查表（常驻）
  $("soloPanel").classList.remove("hidden");
  $("soloTable").innerHTML = SOLO_TIERS.map(([lv, vv]) =>
    `<div class="solo-row"><span class="lv"></span><span class="vv"></span></div>`).join("");
  document.querySelectorAll("#soloTable .solo-row").forEach((row, i) => {
    row.querySelector(".lv").textContent = SOLO_TIERS[i][0];
    row.querySelector(".vv").textContent = SOLO_TIERS[i][1];
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
  $("btnMenu").onclick = () => $("sidebar").classList.toggle("open");
  $("btnExport").onclick = () => current && window.open(`/api/projects/${current.id}/export`);
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
      <button class="del" title="删除">✕</button></div>`;
    el.querySelector(".t").textContent = p.title;
    el.querySelector(".mb").textContent = MODE_NAME[p.mode] || p.mode;
    el.querySelector(".nd").textContent = p.current_node || "";
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

/* ---------- 项目打开 / 新建 ---------- */
async function openProject(id) {
  const d = await api(`/api/projects/${id}`);
  current = d.project;
  renderShell();
  $("chat").innerHTML = "";
  for (const m of d.messages) addMessage(m.role, m.content, { save: false });
  refreshProgress();
  scrollBottom(true);
}

async function createProject() {
  const title = $("npTitle").value.trim() || "未命名课题";
  const mode = document.querySelector('input[name="npmode"]:checked').value;
  const d = await api("/api/projects", {
    method: "POST", body: JSON.stringify({ title, mode }),
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
      let html = "<table>";
      cells.forEach((row, i) => {
        html += "<tr>" + row.map(c => `<${i === 0 ? "th" : "td"}>${c}</td>`.replace("td>", i === 0 ? "th>" : "td>")).join("") + "</tr>";
      });
      out.push(html + "</table>");
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
  wrap.className = `msg ${role}`;
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
  if (full) {
    bubble.innerHTML = renderMD(full);
    const wrap = bubble.parentElement;
    const tools = document.createElement("div");
    tools.className = "tools";
    const cp = document.createElement("button");
    cp.className = "ghost"; cp.textContent = "⧉ 复制";
    cp.onclick = () => { navigator.clipboard.writeText(full); cp.textContent = "✓ 已复制"; setTimeout(() => cp.textContent = "⧉ 复制", 1500); };
    tools.appendChild(cp);
    wrap.appendChild(tools);
  }
  scrollBottom(false);
  refreshProgress();
  loadProjects();
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
  if (d.handoff) { addMessage("user", d.handoff); streamOnce(); }
  loadProjects();
}

init();
