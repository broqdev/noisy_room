import { defineConfig } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

type CodexSessionFile = {
  path: string;
  relativePath: string;
  displayPath: string;
  modifiedAt: string;
  size: number;
  lineCount: number | null;
  threadId: string | null;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentRole: string | null;
};

type GlobalSearchTask = {
  id: string;
  query: string;
  status: "queued" | "running" | "complete" | "error";
  createdAt: string;
  completedAt: string | null;
  root: string | null;
  error: string | null;
  matches: GlobalSearchMatch[];
  scannedFiles: number;
  scannedLines: number;
};

type GlobalSearchTaskSummary = Omit<GlobalSearchTask, "matches"> & {
  matchCount: number;
};

type GlobalSearchMatch = {
  file: CodexSessionFile;
  line: number | null;
  preview: string;
};

type CustomJsonFile = {
  path: string;
  displayPath: string;
  modifiedAt: string;
  size: number;
  lineCount: number | null;
};

const GLOBAL_SEARCH_MATCH_LIMIT = 500;
const GLOBAL_SEARCH_PER_FILE_LIMIT = 40;
const execFileAsync = promisify(execFile);

export default defineConfig({
  plugins: [react(), codexSessionsPlugin()],
  server: {
    port: 5173,
  },
});

function codexSessionsPlugin(): Plugin {
  const searchTasks = new Map<string, GlobalSearchTask>();

  return {
    name: "codex-sessions-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void,
      ) => {
        const requestUrl = new URL(request.url ?? "/", "http://localhost");

        try {
          if (requestUrl.pathname === "/api/codex-sessions") {
            const root = await codexSessionsRoot();
            const files = await collectCodexRolloutFiles(root);
            sendJson(response, { root, files });
            return;
          }

          if (
            requestUrl.pathname === "/api/custom-file/open" &&
            request.method === "POST"
          ) {
            const filePath = await selectCustomJsonFilePath();
            if (!filePath) {
              sendJson(response, { canceled: true });
              return;
            }

            if (!(await isAllowedCustomJsonPath(filePath))) {
              sendJson(
                response,
                { error: "Choose a .json or .jsonl file." },
                400,
              );
              return;
            }

            const content = await fs.readFile(filePath, "utf8");
            sendJson(response, {
              canceled: false,
              file: await toCustomJsonFile(filePath),
              content,
            });
            return;
          }

          if (
            requestUrl.pathname === "/search/new" &&
            request.method === "GET"
          ) {
            const query = requestUrl.searchParams.get("q")?.trim();
            if (!query) {
              sendRedirect(response, "/");
              return;
            }

            const root = await codexSessionsRoot();
            const task = createGlobalSearchTask(query);
            searchTasks.set(task.id, task);
            void runGlobalSearchTask(task, root);
            sendRedirect(response, `/search/${encodeURIComponent(task.id)}`);
            return;
          }

          if (
            requestUrl.pathname === "/api/search-tasks" &&
            request.method === "GET"
          ) {
            const tasks = Array.from(searchTasks.values())
              .map(toGlobalSearchTaskSummary)
              .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
            sendJson(response, { tasks });
            return;
          }

          if (
            requestUrl.pathname === "/api/search-tasks" &&
            request.method === "POST"
          ) {
            const body = await readRequestJson(request);
            const query = isJsonObject(body) ? getString(body.query)?.trim() : null;
            if (!query) {
              sendJson(response, { error: "Missing search query." }, 400);
              return;
            }

            const root = await codexSessionsRoot();
            const task = createGlobalSearchTask(query);
            searchTasks.set(task.id, task);
            void runGlobalSearchTask(task, root);
            sendJson(response, { taskId: task.id, task }, 202);
            return;
          }

          if (
            requestUrl.pathname.startsWith("/api/search-tasks/") &&
            request.method === "GET"
          ) {
            const taskId = requestUrl.pathname.split("/").pop() ?? "";
            const task = searchTasks.get(taskId);
            if (!task) {
              sendJson(response, { error: "Search task not found." }, 404);
              return;
            }

            sendJson(response, { task });
            return;
          }

          if (requestUrl.pathname === "/api/codex-session") {
            const root = await codexSessionsRoot();
            const filePath = requestUrl.searchParams.get("path");

            if (!filePath) {
              sendJson(response, { error: "Missing session path." }, 400);
              return;
            }

            const resolvedPath = path.resolve(filePath);
            if (!(await isAllowedCodexRolloutPath(root, resolvedPath))) {
              sendJson(response, { error: "Session path is outside Codex sessions." }, 403);
              return;
            }

            const content = await fs.readFile(resolvedPath, "utf8");
            const stats = await fs.stat(resolvedPath);
            sendJson(response, {
              file: await toCodexSessionFile(root, resolvedPath, stats),
              content,
            });
            return;
          }
        } catch (error) {
          sendJson(
            response,
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to read Codex sessions.",
            },
            500,
          );
          return;
        }

        next();
      });
    },
  };
}

async function selectCustomJsonFilePath() {
  if (process.platform !== "darwin") {
    throw new Error("Backend file picker is only available on macOS.");
  }

  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'set selectedFile to choose file with prompt "Open a JSON or JSONL file"',
      "-e",
      "POSIX path of selectedFile",
    ]);
    const filePath = stdout.trim();
    return filePath ? path.resolve(filePath) : null;
  } catch (error) {
    if (isAppleScriptCancel(error)) {
      return null;
    }

    throw error;
  }
}

function isAppleScriptCancel(error: unknown) {
  if (!isJsonObject(error)) {
    return false;
  }

  const stderr = getString(error.stderr) ?? "";
  const message = getString(error.message) ?? "";
  return stderr.includes("User canceled") || message.includes("User canceled");
}

async function isAllowedCustomJsonPath(filePath: string) {
  const stats = await fs.stat(filePath).catch(() => null);
  return !!stats?.isFile() && isJsonLikeFile(filePath);
}

async function toCustomJsonFile(filePath: string): Promise<CustomJsonFile> {
  const stats = await fs.stat(filePath);
  return {
    path: filePath,
    displayPath: filePath.replace(os.homedir(), "~"),
    modifiedAt: stats.mtime.toISOString(),
    size: Number(stats.size),
    lineCount: await countLines(filePath),
  };
}

async function codexSessionsRoot() {
  const codexHome = path.resolve(
    process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  );
  const sessions = path.join(codexHome, "sessions");

  if (await pathExists(sessions)) {
    return sessions;
  }

  return codexHome;
}

async function collectCodexRolloutFiles(root: string) {
  if (!(await pathExists(root))) {
    return [];
  }

  const files: CodexSessionFile[] = [];
  const pendingDirs = [root];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop()!;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pendingDirs.push(entryPath);
      } else if (entry.isFile() && isCodexRolloutFile(entry.name)) {
        files.push(await toCodexSessionFile(root, entryPath));
      }
    }
  }

  return files.sort((left, right) =>
    right.modifiedAt.localeCompare(left.modifiedAt) ||
    left.relativePath.localeCompare(right.relativePath),
  );
}

function createGlobalSearchTask(query: string): GlobalSearchTask {
  return {
    id: randomUUID(),
    query,
    status: "queued",
    createdAt: new Date().toISOString(),
    completedAt: null,
    root: null,
    error: null,
    matches: [],
    scannedFiles: 0,
    scannedLines: 0,
  };
}

function toGlobalSearchTaskSummary(task: GlobalSearchTask): GlobalSearchTaskSummary {
  const { matches, ...summary } = task;
  return {
    ...summary,
    matchCount: matches.length,
  };
}

async function runGlobalSearchTask(task: GlobalSearchTask, root: string) {
  task.status = "running";
  task.root = root;

  try {
    const files = await collectCodexRolloutFiles(root);
    const normalizedQuery = task.query.toLowerCase();

    for (const file of files) {
      if (task.matches.length >= GLOBAL_SEARCH_MATCH_LIMIT) {
        break;
      }

      task.scannedFiles += 1;
      let fileMatches = 0;

      if (
        file.relativePath.toLowerCase().includes(normalizedQuery) ||
        file.displayPath.toLowerCase().includes(normalizedQuery) ||
        file.threadId?.toLowerCase().includes(normalizedQuery) ||
        file.parentThreadId?.toLowerCase().includes(normalizedQuery)
      ) {
        task.matches.push({
          file,
          line: null,
          preview: file.relativePath,
        });
        fileMatches += 1;
      }

      for await (const { line, lineNumber } of readLines(file.path)) {
        task.scannedLines += 1;
        if (!line.toLowerCase().includes(normalizedQuery)) {
          continue;
        }

        task.matches.push({
          file,
          line: lineNumber,
          preview: compactSearchPreview(line),
        });
        fileMatches += 1;

        if (
          task.matches.length >= GLOBAL_SEARCH_MATCH_LIMIT ||
          fileMatches >= GLOBAL_SEARCH_PER_FILE_LIMIT
        ) {
          break;
        }
      }
    }

    task.status = "complete";
  } catch (error) {
    task.status = "error";
    task.error =
      error instanceof Error ? error.message : "Unable to complete search.";
  } finally {
    task.completedAt = new Date().toISOString();
  }
}

async function* readLines(filePath: string) {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({
    input,
    crlfDelay: Infinity,
  });
  let lineNumber = 0;

  try {
    for await (const line of reader) {
      lineNumber += 1;
      yield { line, lineNumber };
    }
  } finally {
    reader.close();
    input.destroy();
  }
}

function compactSearchPreview(value: string) {
  const compacted = value.trim().replace(/\s+/g, " ");
  return compacted.length > 260 ? `${compacted.slice(0, 260)}...` : compacted;
}

async function toCodexSessionFile(
  root: string,
  filePath: string,
  existingStats?: Awaited<ReturnType<typeof fs.stat>>,
): Promise<CodexSessionFile> {
  const stats = existingStats ?? (await fs.stat(filePath));
  const relativePath = path.relative(root, filePath);

  return {
    path: filePath,
    relativePath,
    displayPath: path.join("~", ".codex", "sessions", relativePath),
    modifiedAt: stats.mtime.toISOString(),
    size: Number(stats.size),
    lineCount: await countLines(filePath),
    ...(await readCodexSessionMetadata(filePath)),
  };
}

async function readCodexSessionMetadata(filePath: string) {
  const fallback = {
    threadId: null,
    parentThreadId: null,
    agentNickname: null,
    agentRole: null,
  };

  try {
    const firstLine = await readFirstLine(filePath);
    if (!firstLine.trim()) {
      return fallback;
    }

    const parsed = JSON.parse(firstLine) as unknown;
    if (!isJsonObject(parsed)) {
      return fallback;
    }

    const payload = isJsonObject(parsed.payload) ? parsed.payload : parsed;
    const parentThreadId =
      getString(payload.parent_thread_id) ??
      getNestedString(payload, ["source", "subagent", "thread_spawn", "parent_thread_id"]) ??
      getNestedString(payload, ["source", "thread_spawn", "parent_thread_id"]) ??
      getNestedString(payload, ["source", "parent_thread_id"]);

    return {
      threadId: getString(payload.id),
      parentThreadId,
      agentNickname: getString(payload.agent_nickname),
      agentRole: getString(payload.agent_role),
    };
  } catch {
    return fallback;
  }
}

async function readFirstLine(filePath: string) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  let text = "";

  for await (const chunk of stream) {
    text += String(chunk);
    const newlineIndex = text.indexOf("\n");
    if (newlineIndex >= 0) {
      stream.destroy();
      return text.slice(0, newlineIndex).replace(/\r$/, "");
    }

    if (text.length > 1_000_000) {
      stream.destroy();
      return text;
    }
  }

  return text.replace(/\r$/, "");
}

async function countLines(filePath: string) {
  try {
    let lines = 0;
    let hasBytes = false;
    let lastByte: number | null = null;

    for await (const chunk of createReadStream(filePath)) {
      hasBytes = true;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of buffer) {
        if (byte === 10) {
          lines += 1;
        }
        lastByte = byte;
      }
    }

    if (!hasBytes) {
      return 0;
    }

    return lastByte === 10 ? lines : lines + 1;
  } catch {
    return null;
  }
}

async function isAllowedCodexRolloutPath(root: string, filePath: string) {
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const fileName = path.basename(filePath);

  return (
    filePath.startsWith(rootWithSeparator) &&
    isCodexRolloutFile(fileName) &&
    (await pathExists(filePath))
  );
}

function isCodexRolloutFile(fileName: string) {
  return fileName.startsWith("rollout-") && isJsonLikeFile(fileName);
}

function isJsonLikeFile(filePath: string) {
  const lowerCasePath = filePath.toLowerCase();
  return lowerCasePath.endsWith(".jsonl") || lowerCasePath.endsWith(".json");
}

function getNestedString(value: unknown, keys: string[]) {
  let current = value;

  for (const key of keys) {
    if (!isJsonObject(current)) {
      return null;
    }

    current = current[key];
  }

  return getString(current);
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRequestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody.trim()) {
    return null;
  }

  return JSON.parse(rawBody) as unknown;
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sendJson(
  response: ServerResponse,
  body: unknown,
  statusCode = 200,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendRedirect(
  response: ServerResponse,
  location: string,
  statusCode = 302,
) {
  response.statusCode = statusCode;
  response.setHeader("Location", location);
  response.end();
}
