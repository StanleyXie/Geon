import type { ToolKind, ToolCallLocation } from "@agentclientprotocol/sdk";

export interface ToolDefinition {
  name: string;
  description: string;
  kind: ToolKind;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: "string" | "number" | "boolean" | "array" | "object" | "null"; description: string;[k: string]: unknown }>;
    required: string[];
  };
  getTitle?: (input: any) => string;
  getLocations?: (input: any) => ToolCallLocation[];
}

export const BUILT_IN_TOOLS: readonly ToolDefinition[] = [
  {
    name: "Read",
    description: "Read the contents of a file. Returns the file content with line count. Use offset and limit to read a specific range of lines.",
    kind: "read",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to read" },
        offset: { type: "number", description: "1-based line number to start reading from (optional)" },
        limit: { type: "number", description: "Maximum number of lines to read (optional)" },
      },
      required: ["path"],
    },
    getTitle: (input) => {
      let limit = "";
      if (input.limit && input.limit > 0) {
        limit = ` (${input.offset ?? 1} - ${(input.offset ?? 1) + input.limit - 1})`;
      } else if (input.offset) {
        limit = ` (from line ${input.offset})`;
      }
      return `Read ${input.path}${limit}`;
    },
    getLocations: (input) => input.path ? [{ path: input.path, line: input.offset ?? 1 }] : [],
  },
  {
    name: "Write",
    description: "Write content to a file, creating it (and any parent directories) if it does not exist, or overwriting it if it does.",
    kind: "edit",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to write" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    },
    getTitle: (input) => `Write ${input.path}`,
    getLocations: (input) => input.path ? [{ path: input.path }] : [],
  },
  {
    name: "Edit",
    description: "Edit a file by replacing the first exact occurrence of old_string with new_string. Fails if old_string is not found.",
    kind: "edit",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to edit" },
        old_string: { type: "string", description: "Exact string to find and replace" },
        new_string: { type: "string", description: "String to replace it with" },
      },
      required: ["path", "old_string", "new_string"],
    },
    getTitle: (input) => `Edit ${input.path}`,
    getLocations: (input) => [{ path: input.path }],
  },
  {
    name: "Bash",
    description: "Execute a shell command and return its stdout and stderr. Commands run in the current working directory.",
    kind: "execute",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 10000)" },
      },
      required: ["command"],
    },
    getTitle: (input) => input.command || "Terminal",
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern. Returns sorted list of matching paths. Note: node_modules, .git, and build directories are ignored by default.",
    kind: "search",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. '**/*.ts' or 'src/**/*.json'" },
        path: { type: "string", description: "Base directory to search in (default: cwd)" },
      },
      required: ["pattern"],
    },
    getTitle: (input) => `find \`${input.path || "."}\` \`${input.pattern}\``,
    getLocations: (input) => input.path ? [{ path: input.path }] : [],
  },
  {
    name: "Find",
    description: "Alias for Glob. Find files matching a glob pattern.",
    kind: "search",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern" },
        path: { type: "string", description: "Base directory" },
      },
      required: ["pattern"],
    },
    getTitle: (input) => `find \`${input.path || "."}\` \`${input.pattern}\``,
    getLocations: (input) => input.path ? [{ path: input.path }] : [],
  },
  {
    name: "Grep",
    description: "Search file contents for a regular expression pattern. Returns matching lines with file paths and line numbers.",
    kind: "search",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for" },
        path: { type: "string", description: "Directory or file to search (default: cwd)" },
        glob: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts'). Default: '**/*'" },
      },
      required: ["pattern"],
    },
    getTitle: (input) => `grep \`${input.pattern}\` \`${input.path || "."}\``,
    getLocations: (input) => input.path ? [{ path: input.path }] : [],
  },
  {
    name: "LS",
    description: "List the contents of a directory (non-recursive). Directories are shown with a trailing /.",
    kind: "search",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
      },
      required: ["path"],
    },
    getTitle: (input) => `ls ${input.path}`,
    getLocations: (input) => input.path ? [{ path: input.path }] : [],
  },
  {
    name: "WebFetch",
    description: "Fetch content from a URL and return it as plain text. HTML is stripped to readable text. Useful for reading documentation, articles, or any public web page.",
    kind: "fetch",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch content from" },
      },
      required: ["url"],
    },
    getTitle: (input) => `Fetch ${input.url}`,
  },
  {
    name: "WebSearch",
    description: "Standard web search. Use this for general queries, finding links, or documentation. Highly recommended as it uses the local SearXNG instance if configured.",
    kind: "fetch",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        allowed_domains: { type: "array", items: { type: "string" }, description: "Only include results from these domains (optional)" },
        blocked_domains: { type: "array", items: { type: "string" }, description: "Never include results from these domains (optional)" },
      },
      required: ["query"],
    },
    getTitle: (input) => `Search: ${input.query}`,
  },
  {
    name: "GoogleGroundedSearch",
    description: "Cloud-based search using Google's native grounding (Requires Gemini API Key). Returns a full descriptive answer with citations. Use only if a deep, cited explanation is specifically needed and you are comfortable with cloud-based processing.",
    kind: "fetch",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The descriptive question or search prompt (e.g., 'What are the latest changes in the Zed plugin API?')" },
      },
      required: ["prompt"],
    },
    getTitle: (input) => `Natural Search: ${input.prompt}`,
  },
];
