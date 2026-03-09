export interface HeaderLine {
  type: "header";
  sessionId: string;
  parentSessionId: string | null;
  model: string;
  provider: "anthropic" | "google" | "google-claude" | "local" | "llama_cpp" | "lmstudio";
  cwd: string;
  createdAt: number;
}

export interface MessageLine {
  type: "message";
  role: "user" | "model";
  parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }>;
  content: string;
  thoughtSignature?: string;
  uuid: string;
  parentUuid: string | null;
  timestamp: number;
}

export interface ToolCallLine {
  type: "tool_call";
  toolName: string;
  input: unknown;
  result: unknown;
  thoughtSignature?: string;
  isError: boolean;
  uuid: string;
  timestamp: number;
}

export interface ModelSwitchLine {
  type: "model_switch";
  fromModel: string;
  toModel: string;
  timestamp: number;
}

export interface UsageLine {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  timestamp: number;
}

export type SessionLine = HeaderLine | MessageLine | ToolCallLine | ModelSwitchLine | UsageLine;

export interface SessionSummary {
  id: string;
  model: string;
  cwd: string;
  createdAt: number;
  firstMessage: string;
  updatedAt: number;
  parentSessionId: string | null;
}
