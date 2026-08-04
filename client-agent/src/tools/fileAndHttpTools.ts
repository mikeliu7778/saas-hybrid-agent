import type { ToolHandler, ToolResult } from "./ToolHost.js";
import { truncateToolResult } from "./ToolHost.js";
import type { WorkspaceFs } from "./workspace.js";

export {
  MemoryWorkspace,
  OpfsWorkspace,
  normalizeWorkspacePath,
  type WorkspaceFs,
} from "./workspace.js";

export function createFileTools(ws: WorkspaceFs): ToolHandler[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file from the app sandbox",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      },
      async execute(argsJson): Promise<ToolResult> {
        const { path } = JSON.parse(argsJson) as { path?: string };
        if (!path) return { ok: false, content: "missing path" };
        try {
          const content = await ws.read(path);
          if (content === undefined) return { ok: false, content: `not found: ${path}` };
          return { ok: true, content: truncateToolResult(content) };
        } catch (e) {
          return { ok: false, content: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "write_file",
          description: "Write a file in the app sandbox",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      },
      async execute(argsJson): Promise<ToolResult> {
        const { path, content } = JSON.parse(argsJson) as { path?: string; content?: string };
        if (!path || content === undefined) return { ok: false, content: "missing path/content" };
        try {
          await ws.write(path, content);
          return { ok: true, content: `wrote ${path}` };
        } catch (e) {
          return { ok: false, content: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "list_dir",
          description: "List files in a sandbox directory",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      },
      async execute(argsJson): Promise<ToolResult> {
        const { path } = (argsJson ? JSON.parse(argsJson) : {}) as { path?: string };
        try {
          const entries = await ws.list(path ?? "/");
          return { ok: true, content: entries.join("\n") || "(empty)" };
        } catch (e) {
          return { ok: false, content: e instanceof Error ? e.message : String(e) };
        }
      },
    },
  ];
}

export function createHttpTool(allowlist: string[]): ToolHandler {
  const allowed = new Set(allowlist.map((h) => h.toLowerCase()));
  return {
    definition: {
      type: "function",
      function: {
        name: "http_request",
        description: "HTTP GET/POST to an allowlisted host",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            method: { type: "string", enum: ["GET", "POST"] },
            body: { type: "string" },
          },
          required: ["url"],
        },
      },
    },
    async execute(argsJson): Promise<ToolResult> {
      const { url, method = "GET", body } = JSON.parse(argsJson) as {
        url?: string;
        method?: string;
        body?: string;
      };
      if (!url) return { ok: false, content: "missing url" };
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return { ok: false, content: "invalid url" };
      }
      if (!allowed.has(host) && !allowed.has("*")) {
        return { ok: false, content: `host not allowlisted: ${host}` };
      }
      try {
        const res = await fetch(url, {
          method,
          body: method === "POST" ? body : undefined,
          headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        });
        const text = truncateToolResult(await res.text());
        return { ok: res.ok, content: `status=${res.status}\n${text}` };
      } catch (e) {
        return { ok: false, content: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
