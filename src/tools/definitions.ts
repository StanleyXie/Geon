export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; [k: string]: unknown }>;
    required: string[];
  };
}

export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: "Read",
    description: "Read the contents of a file. Returns the file content with line count. Use offset and limit to read a specific range of lines.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to read" },
        offset: { type: "number", description: "1-based line number to start reading from (optional)" },
        limit: { type: "number", description: "Maximum number of lines to read (optional)" },
      },
      required: ["path"],
    },
  },
  {
    name: "Write",
    description: "Write content to a file, creating it (and any parent directories) if it does not exist, or overwriting it if it does.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to write" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "Edit",
    description: "Edit a file by replacing the first exact occurrence of old_string with new_string. Fails if old_string is not found.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path to edit" },
        old_string: { type: "string", description: "Exact string to find and replace" },
        new_string: { type: "string", description: "String to replace it with" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "Bash",
    description: "Execute a shell command and return its stdout and stderr. Commands run in the current working directory.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 10000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern. Returns sorted list of matching paths.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. '**/*.ts' or 'src/**/*.json'" },
        path: { type: "string", description: "Base directory to search in (default: cwd)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description: "Search file contents for a regular expression pattern. Returns matching lines with file paths and line numbers.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for" },
        path: { type: "string", description: "Directory or file to search (default: cwd)" },
        glob: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts'). Default: '**/*'" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "LS",
    description: "List the contents of a directory (non-recursive). Directories are shown with a trailing /.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
      },
      required: ["path"],
    },
  },
];
