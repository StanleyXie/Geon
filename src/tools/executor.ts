// src/tools/executor.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";
import { groundedSearch } from "../adapters/gemini.js";

const execFileAsync = promisify(execFile);

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  switch (name) {
    case "Read": return execRead(input, cwd);
    case "Write": return execWrite(input, cwd);
    case "Edit": return execEdit(input, cwd);
    case "Bash": return execBash(input, cwd);
    case "Glob":
    case "Find": return execGlob(input, cwd);
    case "Grep": return execGrep(input, cwd);
    case "LS": return execLs(input, cwd);
    case "WebFetch": return execWebFetch(input);
    case "WebSearch": return execWebSearch(input);
    case "GoogleGroundedSearch": return execGoogleGroundedSearch(input);
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

  // Exclude common noise by default
  const ignore = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/target/**"];
  const matches = await glob(pattern, { cwd: basePath, ignore });

  if (matches.length === 0) return "(no matches)";

  const MAX_FILES = 100;
  const sorted = matches.sort();
  const truncated = sorted.slice(0, MAX_FILES);
  const result = truncated.join("\n");

  if (sorted.length > MAX_FILES) {
    return result + `\n\n(Showing ${MAX_FILES} of ${sorted.length} files. Try a more specific pattern if needed.)`;
  }
  return result + `\n\n(${sorted.length} files)`;
}

async function execGrep(input: Record<string, unknown>, cwd: string): Promise<string> {
  const pattern = String(input["pattern"] ?? "");
  const searchPath = input["path"] ? resolvePath(input["path"], cwd) : cwd;
  const globPattern = input["glob"] ? String(input["glob"]) : "**/*";
  const regex = new RegExp(pattern);

  // Exclude common noise
  const ignore = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/target/**"];
  const files = await glob(globPattern, { cwd: searchPath, nodir: true, absolute: true, ignore });

  const results: string[] = [];
  const MAX_RESULTS = 100;

  for (const file of files.sort()) {
    try {
      const content = await fs.promises.readFile(file, "utf-8");
      const lines = content.split("\n");
      const relPath = path.relative(cwd, file);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          results.push(`${relPath}:${i + 1}: ${lines[i]}`);
          if (results.length >= MAX_RESULTS) break;
        }
      }
      if (results.length >= MAX_RESULTS) break;
    } catch { /* skip unreadable */ }
  }

  if (results.length === 0) return "(no matches)";

  const output = results.join("\n");
  if (results.length >= MAX_RESULTS) {
    return output + `\n\n(Showing first ${MAX_RESULTS} matches. Try a more specific search if needed.)`;
  }
  return output + `\n\n(${results.length} matches)`;
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

// ---------------------------------------------------------------------------
// Web tools
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_BYTES = 200_000;

/** Strip HTML tags and decode common entities, returning plain text. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function execWebFetch(input: Record<string, unknown>): Promise<string> {
  const url = String(input["url"] ?? "");
  if (!url) throw new Error("WebFetch requires url");

  const resp = await fetch(url, {
    headers: { "User-Agent": "antigravity" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  const contentType = resp.headers.get("content-type") ?? "";
  const raw = await resp.text();
  const text = contentType.includes("text/html") || raw.trimStart().startsWith("<")
    ? htmlToPlainText(raw)
    : raw;

  const truncated = text.slice(0, MAX_CONTENT_BYTES);
  const suffix = text.length > MAX_CONTENT_BYTES
    ? `\n\n[truncated — ${text.length.toLocaleString()} chars total]`
    : "";
  return truncated + suffix;
}

// ---------------------------------------------------------------------------
// WebSearch — pluggable provider chain
// ---------------------------------------------------------------------------

// Normalised result shape shared by all providers
interface SearchResult {
  title: string;
  url: string;
  description: string;
}

function formatResults(results: SearchResult[]): string {
  if (!results.length) return "No results found.";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`.trimEnd())
    .join("\n\n") + `\n\n(${results.length} results)`;
}

function applyDomainFilters(
  results: SearchResult[],
  allowed: string[] | undefined,
  blocked: string[] | undefined,
): SearchResult[] {
  if (allowed?.length) {
    results = results.filter(r => allowed.some(d => new URL(r.url).hostname.includes(d)));
  }
  if (blocked?.length) {
    results = results.filter(r => !blocked.some(d => new URL(r.url).hostname.includes(d)));
  }
  return results;
}

// --- Tavily Search API (https://app.tavily.com) ---
// Requires: TAVILY_API_KEY
// Free tier: 1,000 credits/month, no credit card required.
// LLM-optimized: returns pre-extracted content snippets (not just links),
// directly usable as model context without a follow-up WebFetch.
async function searchViaTavily(
  query: string,
  apiKey: string,
  allowed: string[] | undefined,
  blocked: string[] | undefined,
): Promise<SearchResult[]> {
  const body: Record<string, unknown> = {
    query,
    max_results: 10,
    search_depth: "basic",      // 1 credit per query; "advanced" = 2 credits
    include_answer: false,       // we surface raw results to the model directly
    ...(allowed?.length ? { include_domains: allowed } : {}),
    ...(blocked?.length ? { exclude_domains: blocked } : {}),
  };
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Tavily error: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  if (!data || typeof data !== "object") return [];

  return ((data as any).results ?? []).map((r: any) => ({
    title: r.title ?? "No Title",
    url: r.url ?? "",
    description: r.content ?? "",
  }));
}

// --- Google Custom Search JSON API ---
// Requires: GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX (Search Engine ID)
// Setup:    https://developers.google.com/custom-search/v1/overview
// Free tier: 100 queries/day. Paid: $5 per 1,000 queries (up to 10k/day).
async function searchViaGoogle(query: string, apiKey: string, cx: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ key: apiKey, cx, q: query, num: "10" });
  const resp = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Google CSE error: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  if (!data || typeof data !== "object") return [];

  return ((data as any).items ?? []).map((r: any) => ({
    title: r.title ?? "No Title",
    url: r.link ?? "",
    description: r.snippet ?? "",
  }));
}

// --- Brave Search (https://api.search.brave.com) ---
async function searchViaBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: "10" });
  const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { "Accept": "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Brave Search error: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  if (!data || typeof data !== "object") return [];

  return ((data as any).web?.results ?? []).map((r: any) => ({
    title: r.title ?? "No Title",
    url: r.url ?? "",
    description: r.description ?? "",
  }));
}

// --- Serper (https://serper.dev) — Google results via proxy ---
async function searchViaSerper(query: string, apiKey: string): Promise<SearchResult[]> {
  const resp = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Serper error: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  if (!data || typeof data !== "object") return [];

  return ((data as any).organic ?? []).map((r: any) => ({
    title: r.title ?? "No Title",
    url: r.link ?? "",
    description: r.snippet ?? "",
  }));
}

// --- SearXNG (Self-hosted metasearch) ---
// Requires: SEARXNG_URL (e.g. http://localhost:8080 or https://searx.be)
async function searchViaSearXNG(query: string, baseUrl: string): Promise<SearchResult[]> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const resp = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`SearXNG error: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  if (!data || typeof data !== "object") return [];

  return ((data as any).results ?? []).map((r: any) => ({
    title: r.title ?? "No Title",
    url: r.url ?? "",
    description: r.content ?? "",
  }));
}

// --- DuckDuckGo Instant Answers (no API key, limited to well-known topics) ---
// DEPRECATED - Removed to prioritize higher quality providers

// Provider selection: first matching env var wins.
// Priority: Google CSE > Brave > Serper (Google) > SearXNG
async function execWebSearch(input: Record<string, unknown>): Promise<string> {
  const query = String(input["query"] ?? "");
  if (!query) throw new Error("WebSearch requires query");

  const allowed = input["allowed_domains"] as string[] | undefined;
  const blocked = input["blocked_domains"] as string[] | undefined;

  let raw: SearchResult[];
  let provider: string;

  const googleKey = process.env["GOOGLE_CSE_API_KEY"];
  const googleCx = process.env["GOOGLE_CSE_CX"];
  const braveKey = process.env["BRAVE_SEARCH_API_KEY"];
  const serperKey = process.env["SERPER_API_KEY"];
  const searxngUrl = process.env["SEARXNG_URL"];

  if (googleKey && googleCx) {
    raw = await searchViaGoogle(query, googleKey, googleCx);
    provider = "Google CSE";
  } else if (braveKey) {
    raw = await searchViaBrave(query, braveKey);
    provider = "Brave";
  } else if (serperKey) {
    raw = await searchViaSerper(query, serperKey);
    provider = "Serper (Google)";
  } else if (searxngUrl) {
    raw = await searchViaSearXNG(query, searxngUrl);
    provider = "SearXNG";
  } else {
    return "Error: No search provider configured. To use WebSearch, please set one of the following environment variables:\n" +
      "- SEARXNG_URL (e.g. http://localhost:8080)\n" +
      "- BRAVE_SEARCH_API_KEY\n" +
      "- GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX\n" +
      "- SERPER_API_KEY\n\n" +
      "Alternatively, use 'NaturalSearch' for Gemini-powered grounding.";
  }

  const results = applyDomainFilters(raw, allowed, blocked);
  const output = formatResults(results);
  return `[via ${provider}]\n\n${output}`;
}

async function execGoogleGroundedSearch(input: Record<string, unknown>): Promise<string> {
  const prompt = String(input["prompt"] ?? "");
  if (!prompt) throw new Error("GoogleGroundedSearch requires a prompt");

  process.stderr.write(`[GEON] Spawning sub-agent for Google Grounded Search: "${prompt}"\n`);
  const result = await groundedSearch(prompt);
  return result;
}
