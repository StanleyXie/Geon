// src/__tests__/tools-converters.test.ts
import { describe, it, expect } from "bun:test";
import { toGeminiTools } from "../tools/converters.js";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";

describe("toGeminiTools", () => {
  it("converts all 11 tools", () => {
    const result = toGeminiTools(BUILT_IN_TOOLS);
    expect(result).toHaveLength(11);
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
