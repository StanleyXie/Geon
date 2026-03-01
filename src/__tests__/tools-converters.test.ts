// src/__tests__/tools-converters.test.ts
import { describe, it, expect } from "bun:test";
import { toAnthropicTools, toGeminiTools } from "../tools/converters.js";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";

describe("toAnthropicTools", () => {
  it("converts all 7 tools", () => {
    const result = toAnthropicTools(BUILT_IN_TOOLS);
    expect(result).toHaveLength(7);
  });

  it("produces name, description, input_schema fields", () => {
    const result = toAnthropicTools(BUILT_IN_TOOLS);
    for (const t of result) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.input_schema.type).toBe("object");
    }
  });

  it("Read tool has input_schema.properties.path", () => {
    const result = toAnthropicTools(BUILT_IN_TOOLS);
    const read = result.find(t => t.name === "Read")!;
    expect(read.input_schema.properties).toHaveProperty("path");
  });
});

describe("toGeminiTools", () => {
  it("converts all 7 tools", () => {
    const result = toGeminiTools(BUILT_IN_TOOLS);
    expect(result).toHaveLength(7);
  });

  it("produces name, description, parametersJsonSchema fields", () => {
    const result = toGeminiTools(BUILT_IN_TOOLS);
    for (const t of result) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect((t.parametersJsonSchema as { type: string }).type).toBe("object");
    }
  });

  it("Read tool parametersJsonSchema has properties.path and required includes path", () => {
    const result = toGeminiTools(BUILT_IN_TOOLS);
    const read = result.find(t => t.name === "Read")!;
    const schema = read.parametersJsonSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.properties).toHaveProperty("path");
    expect(schema.required).toContain("path");
  });
});
