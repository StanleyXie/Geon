import { describe, it, expect } from "bun:test";
import { ContextGraph } from "../context/graph.js";

describe("ContextGraph (Phase 1 — single node)", () => {
  it("creates a graph with a single root node", () => {
    const graph = ContextGraph.create("claude-sonnet-4-6");
    expect(graph.nodeCount).toBe(1);
    expect(graph.root.parentId).toBeNull();
    expect(graph.root.model).toBe("claude-sonnet-4-6");
  });

  it("root node has a UUID-format id", () => {
    const graph = ContextGraph.create("gemini-2.5-flash");
    expect(graph.root.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("getNode returns root by id", () => {
    const graph = ContextGraph.create("claude-sonnet-4-6");
    const node = graph.getNode(graph.root.id);
    expect(node).toBe(graph.root);
  });

  it("activeNode is root in Phase 1", () => {
    const graph = ContextGraph.create("claude-sonnet-4-6");
    expect(graph.activeNode).toBe(graph.root);
  });

  it("root node has store, l2, l3, engine initialized", () => {
    const graph = ContextGraph.create("claude-sonnet-4-6");
    const node = graph.root;
    expect(node.store).toBeDefined();
    expect(node.l2).toBeDefined();
    expect(node.l3).toBeDefined();
    expect(node.engine).toBeDefined();
  });

  it("addMessage delegates to node.store", () => {
    const graph = ContextGraph.create("claude-sonnet-4-6");
    graph.root.addMessage("user", "hello");
    expect(graph.root.store.snapshot().messageCount).toBe(1);
  });

  it("switchModel updates store, l2, and l3", () => {
    const graph = ContextGraph.create("claude-sonnet-4-6");
    graph.root.switchModel("gemini-2.5-flash");
    expect(graph.root.store.modelId).toBe("gemini-2.5-flash");
    expect(graph.root.l2.modelId).toBe("gemini-2.5-flash");
    expect(graph.root.l3.modelId).toBe("gemini-2.5-flash");
  });

  it("addMessage passes metadata to the store", () => {
    const graph = ContextGraph.create("gemini-2.5-flash");
    const node = graph.activeNode;
    const meta = { toolUseId: "abc", toolName: "Read" };
    const msg = node.addMessage("tool_call", "Read(file.ts)", meta);
    expect(msg.metadata).toEqual(meta);
  });
});
