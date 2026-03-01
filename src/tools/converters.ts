// src/tools/converters.ts
import type { ToolDefinition } from "./definitions.js";
import type Anthropic from "@anthropic-ai/sdk";
import type { FunctionDeclaration } from "@google/genai";

export function toAnthropicTools(tools: readonly ToolDefinition[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));
}

export function toGeminiTools(tools: readonly ToolDefinition[]): FunctionDeclaration[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.inputSchema,
  }));
}
