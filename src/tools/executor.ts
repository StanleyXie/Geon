// src/tools/executor.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";

const execFileAsync = promisify(execFile);

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  switch (name) {
    case "Read":  return execRead(input, cwd);
    case "Write": return execWrite(input, cwd);
    case "Edit":  return execEdit(input, cwd);
    case "Bash":  return execBash(input, cwd);
    case "Glob":  return execGlob(input, cwd);
    case "Grep":  return execGrep(input, cwd);
    case "LS":    return execLs(input, cwd);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function resolvePath(p: unknown, cwd: string): string {
  if (p == null || p === "") return cwd;
  const s = String(p);
  return path.isAbsolute(s) ? s : path.resolve(cwd, s);
}

async function execRead(input: Record<string, unknown>, cwd: string): Promise<string> {
  const filePath = resolvePath(input["path"], cwd);
  const content = await fs.promises.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const offset = typeof input["offset"] === "number" ? input["offset"] - 1 : 0;
  const limit = typeof input["limit"] === "number" ? input["limit"] : lines.length;
  const sliced = lines.slice(offset, offset + limit);
  return sliced.join("\n") + `\n\n(${sliced.length} lines)`;
}

async function execWrite(input: Record<string, unknown>, cwd: string): Promise<string> {
  const filePath = resolvePath(input["path"], cwd);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, String(input["content"] ?? ""), "utf-8");
  return `Written: ${filePath}`;
}

async function execEdit(input: Record<string, unknown>, cwd: string): Promise<string> {
  const filePath = resolvePath(input["path"], cwd);
  const oldStr = String(input["old_string"] ?? "");
  const newStr = String(input["new_string"] ?? "");
  const content = await fs.promises.readFile(filePath, "utf-8");
  if (!content.includes(oldStr)) {
    throw new Error(`old_string not found in ${path.relative(cwd, filePath)}`);
  }
  await fs.promises.writeFile(filePath, content.replace(oldStr, newStr), "utf-8");
  return `Edited: ${path.relative(cwd, filePath)}`;
}

async function execBash(input: Record<string, unknown>, cwd: string): Promise<string> {
  const command = String(input["command"] ?? "");
  const timeout = typeof input["timeout"] === "number" ? input["timeout"] : 10000;
  const shell = process.env["SHELL"] ?? "/bin/sh";
  try {
    const { stdout, stderr } = await execFileAsync(shell, ["-c", command], {
      cwd, timeout, encoding: "utf8",
    });
    return (stdout + (stderr ? `\nstderr: ${stderr}` : "")).trim() || "(no output)";
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const parts = [
      `Error: ${(e.message ?? String(err)).trim()}`,
      e.stdout?.trim() ? `stdout: ${e.stdout.trim()}` : "",
      e.stderr?.trim() ? `stderr: ${e.stderr.trim()}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  }
}

async function execGlob(input: Record<string, unknown>, cwd: string): Promise<string> {
  const pattern = String(input["pattern"] ?? "");
  const basePath = input["path"] ? resolvePath(input["path"], cwd) : cwd;
  const matches = await glob(pattern, { cwd: basePath });
  if (matches.length === 0) return "(no matches)";
  return matches.sort().join("\n") + `\n\n(${matches.length} files)`;
}

async function execGrep(input: Record<string, unknown>, cwd: string): Promise<string> {
  const pattern = String(input["pattern"] ?? "");
  const searchPath = input["path"] ? resolvePath(input["path"], cwd) : cwd;
  const globPattern = input["glob"] ? String(input["glob"]) : "**/*";
  const regex = new RegExp(pattern);
  const files = await glob(globPattern, { cwd: searchPath, nodir: true, absolute: true });
  const results: string[] = [];
  for (const file of files.sort()) {
    try {
      const content = await fs.promises.readFile(file, "utf-8");
      const lines = content.split("\n");
      const relPath = path.relative(cwd, file);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) results.push(`${relPath}:${i + 1}: ${lines[i]}`);
      }
    } catch { /* skip unreadable */ }
  }
  if (results.length === 0) return "(no matches)";
  return results.join("\n") + `\n\n(${results.length} matches)`;
}

async function execLs(input: Record<string, unknown>, cwd: string): Promise<string> {
  if (!input["path"]) throw new Error("LS requires path");
  const dirPath = resolvePath(input["path"], cwd);
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  if (entries.length === 0) return "(empty directory)";
  return entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => e.name + (e.isDirectory() ? "/" : e.isSymbolicLink() ? "@" : ""))
    .join("\n") + `\n\n(${entries.length} entries)`;
}
