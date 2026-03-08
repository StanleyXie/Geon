import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { hashCwd } from "../utils.js";
import { getModelSpec } from "../context/model-registry.js";
import type { HeaderLine, MessageLine, SessionLine, SessionSummary, UsageLine } from "./types.js";

interface SessionManagerOptions {
  configDir?: string;
  cwd?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidSessionId(sessionId: string): void {
  if (!UUID_RE.test(sessionId)) {
    throw new Error(`Invalid sessionId format: ${JSON.stringify(sessionId)}`);
  }
}

export class SessionManager {
  private _configDir: string;
  private _cwd: string;

  constructor(opts: SessionManagerOptions = {}) {
    this._configDir = opts.configDir ?? path.join(os.homedir(), ".geon");
    this._cwd = path.resolve(opts.cwd ?? process.cwd());
  }

  private _projectDir(): string {
    return path.join(this._configDir, "projects", hashCwd(this._cwd));
  }

  private _sessionPath(sessionId: string): string {
    assertValidSessionId(sessionId);
    return path.join(this._projectDir(), `${sessionId}.jsonl`);
  }

  private _usagePath(sessionId: string): string {
    assertValidSessionId(sessionId);
    return path.join(this._projectDir(), `${sessionId}.usage.jsonl`);
  }

  createSession(modelId: string, sessionId: string = randomUUID(), parentSessionId: string | null = null): string {
    const spec = getModelSpec(modelId);
    fs.mkdirSync(this._projectDir(), { recursive: true, mode: 0o700 });

    const header: HeaderLine = {
      type: "header",
      sessionId,
      parentSessionId,
      model: modelId,
      provider: spec.provider,
      cwd: this._cwd,
      createdAt: Date.now(),
    };

    fs.writeFileSync(this._sessionPath(sessionId), JSON.stringify(header) + "\n", "utf-8");
    return sessionId;
  }

  async appendLine(sessionId: string, line: SessionLine): Promise<void> {
    const data = JSON.stringify(line) + "\n";
    await fs.promises.appendFile(this._sessionPath(sessionId), data, "utf-8");
  }

  async appendMessage(
    sessionId: string,
    msg: {
      role: "user" | "model";
      content: string;
      parts: MessageLine["parts"];
      thoughtSignature?: string;
    },
    parentUuid: string | null = null,
  ): Promise<string> {
    const uuid = randomUUID();
    const line: MessageLine = {
      type: "message",
      role: msg.role,
      parts: msg.parts,
      content: msg.content,
      thoughtSignature: msg.thoughtSignature,
      uuid,
      parentUuid,
      timestamp: Date.now(),
    };
    await this.appendLine(sessionId, line);
    return uuid;
  }

  async appendUsageLine(sessionId: string, line: UsageLine): Promise<void> {
    const data = JSON.stringify(line) + "\n";
    await fs.promises.appendFile(this._usagePath(sessionId), data, "utf-8");
  }

  async readUsageLines(sessionId: string): Promise<UsageLine[]> {
    const filePath = this._usagePath(sessionId);
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as UsageLine);
    } catch {
      return [];
    }
  }

  async readLines(sessionId: string): Promise<SessionLine[]> {
    const filePath = this._sessionPath(sessionId);
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as SessionLine);
    } catch {
      return [];
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    const dir = this._projectDir();
    try {
      const files = await fs.promises.readdir(dir);
      const jsonlFiles = files.filter(f => f.endsWith(".jsonl") && !f.endsWith(".usage.jsonl"));

      const summaries = await Promise.all(jsonlFiles.map(async (file) => {
        const sessionId = file.replace(".jsonl", "");
        const lines = await this.readLines(sessionId);
        const header = lines.find(l => l.type === "header") as HeaderLine | undefined;
        if (!header) return null;
        const firstMsg = lines.find(l => l.type === "message" && (l as MessageLine).role === "user") as MessageLine | undefined;
        let updatedAt = header.createdAt;
        for (const line of lines) {
          if ("timestamp" in line && typeof line.timestamp === "number") {
            updatedAt = Math.max(updatedAt, line.timestamp);
          }
        }
        return {
          id: sessionId,
          model: header.model,
          cwd: header.cwd,
          createdAt: header.createdAt,
          updatedAt,
          firstMessage: firstMsg?.content.slice(0, 100) ?? "New Thread",
          parentSessionId: header.parentSessionId,
        } satisfies SessionSummary;
      }));

      return summaries
        .filter((s): s is SessionSummary => s !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }
}
