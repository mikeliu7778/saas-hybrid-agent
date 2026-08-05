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
} from "../dist/index.js";

const $ = (id) => document.getElementById(id);

/** @type {import("../dist/index.js").ClientAgentRuntime | null} */
let runtime = null;
let sessionId = null;
let deviceId = null;
let token = null;
let mode = "";

function setStatus(text) {
  $("status").textContent = text;
}

function appendBubble(role, text, turnMeta) {
  const log = $("log");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const label = role === "user" ? "你" : "助手";
  div.appendChild(document.createTextNode(`${label}: ${text}`));

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
  ul.innerHTML = "";
  if (!runtime) return;
  const items = await runtime.listMemory();
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "（空）";
    ul.appendChild(li);
    return;
  }
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

function selectedProvider() {
  return $("provider").value || "openai";
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
    setStatus(
      `已注册 device=${deviceId.slice(0, 8)}… provider=${provider} mode=${mode} session=${sessionId.slice(0, 8)}…`,
    );
    await refreshMemory();
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
  if (!text) return;
  input.value = "";
  appendBubble("user", text);

  const assistantEl = appendBubble("assistant", "…");
  let streamed = "";
  try {
    const result = await runtime.runTurn(sessionId, text, (delta) => {
      if (delta.type === "text" && delta.text) {
        streamed += delta.text;
        assistantEl.firstChild.textContent = `助手: ${streamed}`;
      }
    });
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
$("send").onclick = () => void sendMessage();
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
  sessionId = await runtime.createSession();
  setStatus(
    `已切换 provider=${provider} mode=${mode} session=${sessionId.slice(0, 8)}…`,
  );
  await refreshMemory();
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
    sessionId = await runtime.createSession();
    setStatus(
      `已恢复 device=${deviceId.slice(0, 8)}… provider=${provider} mode=${mode}（可重新注册）`,
    );
    await refreshMemory();
  } catch {
    /* ignore stale localStorage */
  }
})();
