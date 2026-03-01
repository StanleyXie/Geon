// src/tools/converters.ts
import type { ToolDefinition } from "./definitions.js";
import type Anthropic from "@anthropic-ai/sdk";

export function toAnthropicTools(tools: readonly ToolDefinition[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export function toGeminiTools(tools: readonly ToolDefinition[]): GeminiFunctionDeclaration[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));
}
