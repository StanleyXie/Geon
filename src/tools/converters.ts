import type { ToolDefinition } from "./definitions.js";
import type { FunctionDeclaration } from "@google/genai";

export function toGeminiTools(tools: readonly ToolDefinition[]): FunctionDeclaration[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.inputSchema,
  }));
}
export function toOpenAITools(tools: readonly ToolDefinition[]): any[] {
  return tools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
