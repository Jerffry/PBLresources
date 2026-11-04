/* 「格物」V2.5 前端逻辑：项目管理 / 双模式节点流 / 徽章渲染 / SSE流式 / 方案包导出 / 模式互导 */
"use strict";

const NODES = {
  global: [["N0","课题解析"],["N1","议题选择"],["N2","目标分层"],["N3","评价设计"],["N4","资源生成"],["N5","实训设计"],["N6","整合输出"]],
  theme:  [["M1","课标解析"],["M2","教材分析"],["M3","主题建构"],["M4","工具实践"],["M5","课件精化"]],
};
const MODE_NAME = { global: "🌍 全球胜任力", theme: "🧩 跨学科主题学习" };
const $ = (id) => document.getElementById(id);

let projects = [];
let current = null;   // {id,title,mode,current_node}
let streaming = false;
let es = null;

/* ---------- 初始化 ---------- */
async function init() {
  const h = await (await fetch("/api/health")).json();
  $("llmState").textContent = h.llm ? `引擎：${h.model}` : "引擎：demo 模式（未配Key）";
  await loadProjects();
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
}

async function loadProjects() {
  const d = await (await fetch("/api/projects")).json();
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
      await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      if (current && current.id === p.id) closeProject();
      loadProjects();
    };
    el.onclick = () => { openProject(p.id); $("sidebar").classList.remove("open"); };
    box.appendChild(el);
  }
}

/* ---------- 项目打开 / 新建 ---------- */
async function openProject(id) {
  const d = await (await fetch(`/api/projects/${id}`)).json();
  current = d.project;
  renderShell();
  $("chat").innerHTML = "";
  for (const m of d.messages) addMessage(m.role, m.content, { save: false });
  refreshProgress();
  $("chat").scrollTop = $("chat").scrollHeight;
}

async function createProject() {
  const title = $("npTitle").value.trim() || "未命名课题";
  const mode = document.querySelector('input[name="npmode"]:checked').value;
  const d = await (await fetch("/api/projects", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, mode }),
  })).json();
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
  if (has) {
    $("modeBadge").textContent = MODE_NAME[current.mode];
    renderNodes(current.mode, []);
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
  });
}

function parseProgress(text) {
  const m = text.match(/【进度[:：]([^】]*)】/);
  if (!m) return null;
  const seg = m[1];
  const done = new Set([...seg.matchAll(/([NM]\d)\s*(?:已完成|待确认)/g)].map(x => x[1]));
  return done;
}

function refreshProgress() {
  if (!current) return;
  const bubbles = [...document.querySelectorAll(".msg.assistant .bubble")];
  const last = bubbles.length ? bubbles[bubbles.length - 1].textContent : "";
  const done = parseProgress(last);
  renderNodes(current.mode, done);
}

/* ---------- 消息渲染（轻量 Markdown + 徽章 + 进度行） ---------- */
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderMD(text) {
  let t = esc(text);
  t = t.replace(/【进度[:：][^】]*】/g, (m) => `<span class="prog-line">${m}</span>`);
  t = t.replace(/【(依据|待核|建议|学情假设)】/g, '<span class="b-$1">$1</span>');
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
  $("chat").scrollTop = $("chat").scrollHeight;
  return bubble;
}

/* ---------- 发送与 SSE ---------- */
async function send() {
  if (!current || streaming) return;
  const text = $("input").value.trim();
  if (!text) return;
  $("input").value = "";
  addMessage("user", text);
  await fetch(`/api/projects/${current.id}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  streamOnce();
}

function streamOnce() {
  streaming = true;
  $("btnSend").disabled = true;
  const bubble = addMessage("assistant", "…", { streaming: true });
  let full = "";
  es = new EventSource(`/api/projects/${current.id}/stream`);
  es.onmessage = (ev) => {
    if (ev.data === "[DONE]") { es.close(); finish(full, bubble); return; }
    try {
      const d = JSON.parse(ev.data);
      if (d.delta) { full += d.delta; bubble.innerHTML = renderMD(full); $("chat").scrollTop = $("chat").scrollHeight; }
      if (d.error) { full += `\n\n⚠️ ${d.error}`; bubble.innerHTML = renderMD(full); }
    } catch (_) {}
  };
  es.onerror = () => { es.close(); finish(full, bubble); };
}

function finish(full, bubble) {
  streaming = false;
  $("btnSend").disabled = false;
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
  refreshProgress();
  loadProjects();
}

/* ---------- 模式互导 ---------- */
async function switchMode() {
  if (!current || streaming) return;
  const to = current.mode === "global" ? "theme" : "global";
  const label = MODE_NAME[to];
  if (!confirm(`将本项目切换为「${label}」模式？\n格物将携带课题与已确认产出的摘要，在新模式下继续设计。`)) return;
  const d = await (await fetch(`/api/projects/${current.id}/switch`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  })).json();
  current.mode = to;
  $("modeBadge").textContent = MODE_NAME[to];
  renderNodes(to, null);
  if (d.handoff) { addMessage("user", d.handoff); streamOnce(); }
  loadProjects();
}

init();
