import { describe, it, expect, afterEach } from "bun:test";
import { SessionManager } from "../session/manager.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HeaderLine, MessageLine } from "../session/types.js";

describe("SessionManager", () => {
  let tmpDir: string;
  let manager: SessionManager;

  function fresh() {
    tmpDir = mkdtempSync(join(tmpdir(), "uacp-test-"));
    manager = new SessionManager({ configDir: tmpDir, cwd: "/test/project" });
  }

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("creates a new session and returns a UUID", () => {
    fresh();
    const id = manager.createSession("claude-sonnet-4-6");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("persists a header line to JSONL", async () => {
    fresh();
    const id = manager.createSession("claude-sonnet-4-6");
    const lines = await manager.readLines(id);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.type).toBe("header");
    expect((lines[0] as HeaderLine).model).toBe("claude-sonnet-4-6");
  });

  it("appendMessage writes a message line", async () => {
    fresh();
    const id = manager.createSession("claude-sonnet-4-6");
    await manager.appendMessage(id, { role: "user", content: "Hello", parts: [{ text: "Hello" }] });
    const lines = await manager.readLines(id);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.type).toBe("message");
    expect((lines[1] as MessageLine).content).toBe("Hello");
  });

  it("lists sessions for current cwd", async () => {
    fresh();
    const id1 = manager.createSession("claude-sonnet-4-6");
    const id2 = manager.createSession("gemini-2.5-flash");
    await manager.appendMessage(id1, { role: "user", content: "First", parts: [{ text: "First" }] });
    await manager.appendMessage(id2, { role: "user", content: "Second", parts: [{ text: "Second" }] });
    const sessions = await manager.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions.map(s => s.id)).toContain(id1);
  });

  it("header has parentSessionId null for root sessions", async () => {
    fresh();
    const id = manager.createSession("claude-sonnet-4-6");
    const lines = await manager.readLines(id);
    expect((lines[0] as HeaderLine).parentSessionId).toBeNull();
  });

  it("appendLine writes arbitrary session lines", async () => {
    fresh();
    const id = manager.createSession("claude-sonnet-4-6");
    await manager.appendLine(id, { type: "usage", inputTokens: 100, outputTokens: 50, cacheHitTokens: 0, timestamp: Date.now() });
    const lines = await manager.readLines(id);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.type).toBe("usage");
  });
});
