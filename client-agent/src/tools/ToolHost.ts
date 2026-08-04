import type { LlmToolDefinition } from "../runtime/types.js";

export interface ToolContext {
  sessionId: string;
  workdir: string;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  unsupported?: boolean;
}

export interface ToolHandler {
  definition: LlmToolDefinition;
  execute(argsJson: string, ctx: ToolContext): Promise<ToolResult>;
}

export class ToolHost {
  private readonly tools = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    this.tools.set(handler.definition.function.name, handler);
  }

  listDefinitions(names?: string[]): LlmToolDefinition[] {
    const all = [...this.tools.values()].map((t) => t.definition);
    if (!names || names.length === 0) return all;
    return all.filter((d) => names.includes(d.function.name));
  }

  async execute(name: string, argsJson: string, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        content: `Unknown tool: ${name}`,
      };
    }
    try {
      return await tool.execute(argsJson, ctx);
    } catch (err) {
      return {
        ok: false,
        content: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function truncateToolResult(content: string, max = 8000): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n...[truncated ${content.length - max} chars]`;
}

export function unsupportedTool(name: string, description: string): ToolHandler {
  return {
    definition: {
      type: "function",
      function: {
        name,
        description,
        parameters: { type: "object", properties: {} },
      },
    },
    async execute(): Promise<ToolResult> {
      return {
        ok: false,
        unsupported: true,
        content: `unsupported: tool '${name}' is not available on this platform`,
      };
    },
  };
}
