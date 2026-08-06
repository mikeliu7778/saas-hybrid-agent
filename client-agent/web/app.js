/**
 * Interactive Trust Demo UI.
 * Served from client-agent root so `../dist/index.js` resolves (npm run demo:web).
 */
import {
  createBrowserRuntime,
  DefaultClientAgentRuntime,
  HttpLlmTransport,
  HttpEmbeddingClient,
  InMemoryMemoryStore,
  ToolHost,
  createFileTools,
  createHttpTool,
  unsupportedTool,
  MemoryWorkspace,
  HttpTrustEventClient,
  TrustEventQueue,
  TrustSignalCollector,
  fetchLlmCapabilities,
} from "../dist/index.js";

const $ = (id) => document.getElementById(id);

const MAX_IMAGES = 5;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** @type {import("../dist/index.js").ClientAgentRuntime | null} */
let runtime = null;
let sessionId = null;
let deviceId = null;
let token = null;
let mode = "";
/** @type {{ dataUrl: string }[]} */
let pendingImages = [];
let vision = false;

function setStatus(text) {
  $("status").textContent = text;
}

function renderImagePreview() {
  const box = $("imagePreview");
  box.innerHTML = "";
  pendingImages.forEach((img, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "thumb";
    const el = document.createElement("img");
    el.src = img.dataUrl;
    el.alt = `preview-${idx}`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.title = "移除";
    rm.onclick = () => {
      pendingImages.splice(idx, 1);
      renderImagePreview();
    };
    wrap.append(el, rm);
    box.appendChild(wrap);
  });
}

/**
 * @param {string} role
 * @param {string} text
 * @param {{ turnMeta?: unknown, dataUrls?: string[] }} [opts]
 */
function appendBubble(role, text, opts) {
  const turnMeta = opts?.turnMeta;
  const dataUrls = opts?.dataUrls;
  const log = $("log");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const label = role === "user" ? "你" : "助手";
  div.appendChild(document.createTextNode(`${label}: ${text}`));

  if (role === "user" && dataUrls?.length) {
    const thumbs = document.createElement("div");
    thumbs.style.display = "flex";
    thumbs.style.flexWrap = "wrap";
    thumbs.style.gap = "0.35rem";
    thumbs.style.marginTop = "0.35rem";
    for (const url of dataUrls) {
      const img = document.createElement("img");
      img.className = "thumb-img";
      img.src = url;
      img.alt = "attached";
      thumbs.appendChild(img);
    }
    div.appendChild(thumbs);
  }

  if (role === "assistant" && turnMeta) {
    const fb = document.createElement("span");
    fb.className = "feedback";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "👍";
    up.title = "采信";
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "👎";
    down.title = "不采信";
    up.onclick = () => sendFeedback(turnMeta, "trust", up, down);
    down.onclick = () => sendFeedback(turnMeta, "distrust", up, down);
    fb.append(up, down);
    div.appendChild(fb);
  }

  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function sendFeedback(turnMeta, signal, upBtn, downBtn) {
  if (!runtime) return;
  try {
    await runtime.submitFeedback({
      sessionId: turnMeta.sessionId,
      turnId: turnMeta.turnId,
      target: "assistant_message",
      targetId: turnMeta.turnId,
      signal,
    });
    upBtn.disabled = true;
    downBtn.disabled = true;
    setStatus(`已提交反馈: ${signal}（turn ${turnMeta.turnId.slice(0, 8)}…）`);
  } catch (e) {
    setStatus(`反馈失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function refreshMemory() {
  const ul = $("mem");
  const epiUl = $("epi");
  const wsUl = $("ws");
  ul.innerHTML = "";
  epiUl.innerHTML = "";
  wsUl.innerHTML = "";
  if (!runtime) return;

  const items = await runtime.listMemory();
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "（空）";
    ul.appendChild(li);
  } else {
    for (const item of items) {
      const li = document.createElement("li");
      const score =
        item.trustScore != null ? ` score=${item.trustScore.toFixed(2)}` : "";
      const dep = item.deprecated ? " [deprecated]" : "";
      li.appendChild(document.createTextNode(`${item.text}${score}${dep} `));
      if (!item.deprecated) {
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "删除";
        del.onclick = async () => {
          await runtime.deleteMemory(item.id);
          await refreshMemory();
        };
        li.appendChild(del);
      }
      ul.appendChild(li);
    }
  }

  const episodes =
    typeof runtime.listEpisodes === "function" ? await runtime.listEpisodes() : [];
  if (episodes.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "（空）";
    epiUl.appendChild(li);
  } else {
    for (const e of episodes) {
      const li = document.createElement("li");
      const src = e.source ? `[${e.source}] ` : "";
      const score =
        e.trustScore != null ? ` score=${Number(e.trustScore).toFixed(2)}` : "";
      const dep = e.deprecated ? " [deprecated]" : "";
      li.appendChild(
        document.createTextNode(`${src}${e.summary}${score}${dep} `),
      );
      if (!e.deprecated && typeof runtime.deleteEpisode === "function") {
        const down = document.createElement("button");
        down.type = "button";
        down.textContent = "👎";
        down.title = "不采信该摘要";
        down.onclick = async () => {
          await runtime.submitFeedback({
            sessionId: sessionId || "local",
            target: "memory_item",
            targetId: e.id,
            signal: "distrust",
          });
          await refreshMemory();
        };
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "删除";
        del.onclick = async () => {
          await runtime.deleteEpisode(e.id);
          await refreshMemory();
        };
        li.append(down, del);
      }
      epiUl.appendChild(li);
    }
  }

  // Workspace hints via runtime API
  try {
    const paths =
      typeof runtime.listWorkspacePaths === "function"
        ? await runtime.listWorkspacePaths()
        : [];
    if (paths.length) {
      for (const p of paths.slice(0, 20)) {
        const li = document.createElement("li");
        li.textContent = p;
        wsUl.appendChild(li);
      }
    } else {
      const li = document.createElement("li");
      li.className = "meta";
      li.textContent = "（空）";
      wsUl.appendChild(li);
    }
  } catch {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "（不可用）";
    wsUl.appendChild(li);
  }
}

/** Sample Cursor-shaped ingest events (camelCase, already scrubbed). */
const SAMPLE_INGEST_EVENTS = [
  {
    eventId: "demo-cursor-sess-1",
    schemaVersion: "1",
    source: "cursor",
    kind: "session_summary",
    summary:
      "Please fix auth flake. We decided to prefer JWT for session cookies. Updated AuthService and README.",
    paths: ["src/auth/AuthService.ts", "README.md"],
    scrubbed: true,
    nativeSessionId: "demo-sess-1",
    skillHint: "1. reproduce flake\n2. patch AuthService\n3. run npm test",
    tsStart: "2026-08-06T01:00:00.000Z",
    tsEnd: "2026-08-06T01:20:00.000Z",
  },
  {
    eventId: "demo-cursor-sess-1:path:0",
    schemaVersion: "1",
    source: "cursor",
    kind: "file_touch",
    summary: "touched src/auth/AuthService.ts",
    paths: ["src/auth/AuthService.ts"],
    scrubbed: true,
  },
];

async function ingestSample() {
  if (!runtime || typeof runtime.applyIngest !== "function") {
    setStatus("请先注册设备（需要 applyIngest）");
    return;
  }
  try {
    const result = await runtime.applyIngest(SAMPLE_INGEST_EVENTS);
    setStatus(
      `Ingest: epi=${result.accepted} sem=${result.semanticAccepted ?? 0} proc=${result.proceduralAccepted ?? 0} dup=${result.duplicates} ws+=${result.workspacePathsAdded}`,
    );
    await refreshMemory();
  } catch (e) {
    setStatus(`Ingest 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function setIngestEnabled(on) {
  $("ingestSample").disabled = !on;
}

function selectedProvider() {
  return $("provider").value || "openai";
}

async function refreshCapabilities() {
  const attach = $("attachImage");
  if (!token) {
    vision = false;
    attach.disabled = true;
    return;
  }
  try {
    const baseUrl = $("baseUrl").value.replace(/\/$/, "");
    const caps = await fetchLlmCapabilities({
      baseUrl,
      token,
      provider: selectedProvider(),
    });
    vision = caps.vision;
    attach.disabled = !vision;
    if (pendingImages.length && !vision) {
      setStatus(
        `当前模型 ${caps.model} 不支持 vision；已保留预览，请换模型后再发`,
      );
    }
  } catch (e) {
    vision = false;
    attach.disabled = true;
    setStatus(`能力查询失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Reuse hydrated OPFS session when present; otherwise create a fresh one.
 * @param {import("../dist/index.js").DefaultClientAgentRuntime | import("../dist/index.js").ClientAgentRuntime} rt
 */
async function resolveSessionId(rt) {
  if (typeof rt.hydrateSessions === "function") {
    const ids = await rt.hydrateSessions();
    if (Array.isArray(ids) && ids.length > 0) {
      return ids[ids.length - 1];
    }
  }
  return rt.createSession();
}

/**
 * OPFS browser runtime, or in-memory fallback with the same trust wiring.
 */
async function createRuntime(baseUrl, tok, devId, provider) {
  try {
    const { runtime: rt } = await createBrowserRuntime({
      baseUrl,
      token: tok,
      deviceId: devId,
      provider,
    });
    return { runtime: rt, mode: "opfs" };
  } catch (err) {
    console.warn("createBrowserRuntime failed; falling back to memory mode", err);
    const workspace = new MemoryWorkspace();
    const tools = new ToolHost();
    for (const t of createFileTools(workspace)) tools.register(t);
    tools.register(createHttpTool(["example.com"]));
    tools.register(unsupportedTool("run_terminal", "Shell is not available on Web"));

    const embedClient = new HttpEmbeddingClient({
      baseUrl,
      token: tok,
    });
    const memory = new InMemoryMemoryStore({
      deviceId: devId,
      embed: (text) => embedClient.embed(text),
    });
    const llm = new HttpLlmTransport({ baseUrl, token: tok, provider });
    const trustCollector = new TrustSignalCollector({ deviceId: devId });
    const trustQueue = new TrustEventQueue();
    const trustClient = new HttpTrustEventClient({ baseUrl, token: tok });
    const rt = new DefaultClientAgentRuntime({
      llm,
      tools,
      memory,
      deviceId: devId,
      trustCollector,
      trustQueue,
      trustClient,
    });
    return { runtime: rt, mode: "memory" };
  }
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * @param {File[]} files
 */
async function addImageFiles(files) {
  if (!token) {
    setStatus("请先注册设备后再添加图片");
    return;
  }
  if (!vision) {
    setStatus("当前模型不支持 vision，请更换模型后再添加图片");
    return;
  }
  for (const file of files) {
    if (pendingImages.length >= MAX_IMAGES) {
      setStatus(`最多附 ${MAX_IMAGES} 张图片`);
      break;
    }
    if (!IMAGE_MIME.has(file.type)) {
      setStatus(`不支持的图片类型: ${file.type || file.name}`);
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    pendingImages.push({ dataUrl });
  }
  renderImagePreview();
}

async function registerDevice() {
  const baseUrl = $("baseUrl").value.replace(/\/$/, "");
  setStatus("注册中…");
  try {
    const res = await fetch(`${baseUrl}/v1/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "trust-demo-web", platform: "web" }),
    });
    if (!res.ok) throw new Error(`register ${res.status}`);
    const body = await res.json();
    deviceId = body.deviceId;
    token = body.token;
    localStorage.setItem(
      "trust-demo",
      JSON.stringify({ baseUrl, deviceId, token }),
    );

    const provider = selectedProvider();
    const created = await createRuntime(baseUrl, token, deviceId, provider);
    runtime = created.runtime;
    mode = created.mode;
    runtime.setTrustReportingEnabled($("reportTrust").checked);
    sessionId = await runtime.createSession();
    $("log").innerHTML = "";
    setStatus(
      `已注册 device=${deviceId.slice(0, 8)}… provider=${provider} mode=${mode} session=${sessionId.slice(0, 8)}…`,
    );
    await refreshCapabilities();
    await refreshMemory();
    setIngestEnabled(true);
  } catch (e) {
    setStatus(`注册失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function sendMessage() {
  if (!runtime || !sessionId) {
    setStatus("请先注册设备");
    return;
  }
  const input = $("msg");
  const text = input.value.trim();
  if (!text && pendingImages.length === 0) return;
  if (pendingImages.length && !vision) {
    setStatus("当前模型不支持 vision，请更换模型后再发送（预览已保留）");
    return;
  }
  const images = pendingImages.map((p) => ({ dataUrl: p.dataUrl }));
  const dataUrls = images.map((p) => p.dataUrl);
  input.value = "";
  appendBubble("user", text || "(图片)", { dataUrls });

  const assistantEl = appendBubble("assistant", "…");
  let streamed = "";
  try {
    const result = await runtime.runTurn(
      sessionId,
      text || " ",
      (delta) => {
        if (delta.type === "text" && delta.text) {
          streamed += delta.text;
          assistantEl.firstChild.textContent = `助手: ${streamed}`;
        }
      },
      images.length ? images : undefined,
    );
    pendingImages = [];
    renderImagePreview();
    const finalText = result.assistantText || streamed || "(空回复)";
    assistantEl.replaceChildren();
    assistantEl.appendChild(document.createTextNode(`助手: ${finalText}`));
    const fb = document.createElement("span");
    fb.className = "feedback";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "👍";
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "👎";
    const meta = { sessionId: result.sessionId, turnId: result.turnId };
    up.onclick = () => sendFeedback(meta, "trust", up, down);
    down.onclick = () => sendFeedback(meta, "distrust", up, down);
    fb.append(up, down);
    assistantEl.appendChild(fb);
    if (result.status !== "completed") {
      setStatus(`回合状态: ${result.status}${result.errorMessage ? " — " + result.errorMessage : ""}`);
    }
    await refreshMemory();
  } catch (e) {
    assistantEl.textContent = `助手: [错误] ${e instanceof Error ? e.message : String(e)}`;
    setStatus(`发送失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

$("register").onclick = () => void registerDevice();
$("newSession").onclick = () => void startNewSession();
$("ingestSample").onclick = () => void ingestSample();
$("send").onclick = () => void sendMessage();
$("attachImage").onclick = () => $("imageFile").click();
$("imageFile").onchange = () => {
  const input = $("imageFile");
  const files = Array.from(input.files || []);
  input.value = "";
  void addImageFiles(files);
};

function handlePaste(ev) {
  const items = ev.clipboardData?.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.kind === "file" && IMAGE_MIME.has(item.type)) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length === 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  void addImageFiles(files);
}

$("msg").addEventListener("paste", handlePaste);

$("msg").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    void sendMessage();
  }
});
$("reportTrust").onchange = (ev) => {
  if (runtime) runtime.setTrustReportingEnabled(ev.target.checked);
};

async function recreateRuntimeIfRegistered() {
  if (!token || !deviceId) return;
  const baseUrl = $("baseUrl").value.replace(/\/$/, "");
  const provider = selectedProvider();
  const created = await createRuntime(baseUrl, token, deviceId, provider);
  runtime = created.runtime;
  mode = created.mode;
  runtime.setTrustReportingEnabled($("reportTrust").checked);
  sessionId = await resolveSessionId(runtime);
  setStatus(
    `已切换 provider=${provider} mode=${mode} session=${sessionId.slice(0, 8)}…`,
  );
  await refreshCapabilities();
  await refreshMemory();
}

async function startNewSession() {
  if (!runtime) {
    setStatus("请先注册设备");
    return;
  }
  sessionId = await runtime.createSession();
  $("log").innerHTML = "";
  pendingImages = [];
  renderImagePreview();
  setStatus(`新会话 session=${sessionId.slice(0, 8)}…`);
}

$("provider").onchange = () => void recreateRuntimeIfRegistered();

// Optional: restore prior token + re-init runtime on reload
(async () => {
  try {
    const raw = localStorage.getItem("trust-demo");
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved?.baseUrl || !saved?.token || !saved?.deviceId) return;
    $("baseUrl").value = saved.baseUrl;
    deviceId = saved.deviceId;
    token = saved.token;
    const provider = selectedProvider();
    const created = await createRuntime(saved.baseUrl, saved.token, saved.deviceId, provider);
    runtime = created.runtime;
    mode = created.mode;
    runtime.setTrustReportingEnabled($("reportTrust").checked);
    sessionId = await resolveSessionId(runtime);
    setStatus(
      `已恢复 device=${deviceId.slice(0, 8)}… provider=${provider} mode=${mode} session=${sessionId.slice(0, 8)}…（可重新注册 / 新会话）`,
    );
    await refreshCapabilities();
    await refreshMemory();
    setIngestEnabled(true);
  } catch {
    /* ignore stale localStorage */
  }
})();
