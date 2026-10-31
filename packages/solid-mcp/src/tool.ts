// AUTHORED-BY Codex GPT-6.1-Sol
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { podOutputError } from "./output.js";

/** A registered tool, including its schema, read-only annotation and guarded handler. */
export interface PodTool {
  /** Canonical MCP tool name. */
  name: string;
  /** Compatibility names retained for the 0.2 release. */
  aliases: readonly string[];
  /** Human-readable tool title. */
  title: string;
  /** Tool behavior and restrictions. */
  description: string;
  /** Zod object schema, emitted as JSON Schema by the MCP SDK. */
  inputSchema: z.ZodObject;
  /** Whether the handler is non-mutating. */
  readOnly: boolean;
  /** Validate and execute, returning tool errors instead of throwing. */
  handler(input: unknown): Promise<CallToolResult>;
}

export function toolText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function toolError(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: podOutputError(error).message }],
  };
}

export function defineTool<Shape extends z.ZodRawShape>(
  definition: Omit<PodTool, "inputSchema" | "handler"> & {
    inputSchema: z.ZodObject<Shape>;
    handler(input: z.output<z.ZodObject<Shape>>): Promise<CallToolResult>;
  },
  readOnly: boolean,
): PodTool {
  return {
    ...definition,
    async handler(input) {
      if (!definition.readOnly && readOnly) {
        return toolError(
          "write disabled: server is read-only (set readOnly:false to enable writes).",
        );
      }
      try {
        return await definition.handler(definition.inputSchema.parse(input));
      } catch (error) {
        return toolError(error);
      }
    },
  };
}
