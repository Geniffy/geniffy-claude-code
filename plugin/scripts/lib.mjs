// Shared by every script in the plugin: where its files live, the sign-in, calls to the Geniffy memory
// tools, and what is kept out of anything saved. Node 18 or later, no dependencies.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const API = (process.env.GENIFFY_API_URL || "https://api.geniffy.com").replace(/\/+$/, "");
export const MCP_URL = `${API}/mcp`;
export const SCOPES = "memory:read memory:write";
const PROTOCOL = "2025-11-25";

// Everything the plugin keeps on this computer. Not the plugin's own data folder: the MCP sign-in helper
// runs without that folder's path, and it has to find the same sign-in as the hooks.
export const HOME = process.env.GENIFFY_PLUGIN_HOME || path.join(os.homedir(), ".geniffy", "claude-code");
const file = (name) => path.join(HOME, name);

// ── files ───────────────────────────────────────────────────────────────────────────────────────────────
export function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return null;
  }
}

// Written whole and then renamed into place, so a reader never sees half a file, and readable only by
// this user where the system allows it.
export function writeJson(name, value) {
  fs.mkdirSync(path.dirname(file(name)), { recursive: true, mode: 0o700 });
  const tmp = file(`${name}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file(name));
}

// Prompts left behind by turns that never finished, a couple of days old, are cleared out, and where old
// sessions' saves stopped, after a month.
export function sweepTurns(olderThanMs = 2 * 24 * 3600_000) {
  for (const [dir, age] of [[file("turns"), olderThanMs], [file("cursors"), 30 * 24 * 3600_000]]) {
    try {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (Date.now() - fs.statSync(p).mtimeMs > age) fs.rmSync(p, { force: true });
      }
    } catch {}
  }
}

export function removeFile(name) {
  fs.rmSync(file(name), { recursive: true, force: true });
}

export const state = () => readJson("state.json") || {};
export const setState = (patch) => writeJson("state.json", { ...state(), ...patch });

// ── the sign-in ─────────────────────────────────────────────────────────────────────────────────────────
export class NotSignedIn extends Error {
  constructor() {
    super("Not signed in to Geniffy. Run /geniffy:login.");
    this.name = "NotSignedIn";
  }
}

export const credentials = () => readJson("credentials.json");

// Saving needs a sign-in that allowed it, and saving not paused.
export const canSave = () => {
  const creds = credentials();
  return Boolean(creds && String(creds.scope || "").includes("memory:write") && !state().paused);
};

let metadata;
export async function discover() {
  if (!metadata) {
    const res = await fetchWithin(`${API}/.well-known/oauth-authorization-server`, {}, 8000);
    if (!res.ok) throw new Error(`Geniffy's sign-in is not reachable (HTTP ${res.status}).`);
    metadata = await res.json();
  }
  return metadata;
}

export function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

// A refresh token works once: Geniffy treats a second use as theft and ends the sign-in. Several hooks and
// the MCP helper can need a fresh token at the same moment, so a refresh happens under a lock, and whoever
// gets the lock second finds the token already refreshed.
async function withLock(fn) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const lock = file("refresh.lock");
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 20000) fs.rmSync(lock, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

const FRESH_FOR_MS = 60_000;

// A token that works for at least another minute, refreshed if it needs to be; null when signed out.
export async function accessToken({ force = false } = {}) {
  let creds = credentials();
  if (!creds) return null;
  if (!force && creds.expires_at - Date.now() > FRESH_FOR_MS) return creds.access_token;
  const seen = creds.access_token;
  return withLock(async () => {
    creds = credentials();
    if (!creds) return null;
    if (creds.access_token !== seen || (!force && creds.expires_at - Date.now() > FRESH_FOR_MS)) {
      return creds.access_token; // another process refreshed while this one waited
    }
    const meta = await discover();
    const res = await fetchWithin(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: creds.refresh_token,
                                  client_id: creds.client_id, resource: MCP_URL }),
    }, 8000);
    if (!res.ok) {
      // Only a refusal of the refresh token itself means the sign-in is over; anything else may pass.
      const body = await res.json().catch(() => ({}));
      if (body.error === "invalid_grant" || body.error === "invalid_client") removeFile("credentials.json");
      return null;
    }
    const t = await res.json();
    writeJson("credentials.json", { ...creds, access_token: t.access_token, refresh_token: t.refresh_token || creds.refresh_token,
                                    expires_at: Date.now() + (t.expires_in || 3600) * 1000, scope: t.scope || creds.scope });
    return t.access_token;
  });
}

// ── the memory tools ────────────────────────────────────────────────────────────────────────────────────
export class ToolError extends Error {
  name = "ToolError";
}

async function rpc(token, method, params, timeoutMs) {
  return fetchWithin(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
               "MCP-Protocol-Version": PROTOCOL, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }, timeoutMs);
}

// One JSON-RPC call to Geniffy's MCP server with this computer's sign-in, retried once with a fresh token
// when the server says the token is no longer good.
export async function call(method, params = {}, { timeoutMs = 15000 } = {}) {
  let token = await accessToken();
  if (!token) throw new NotSignedIn();
  let res = await rpc(token, method, params, timeoutMs);
  if (res.status === 401) {
    token = await accessToken({ force: true });
    if (!token) throw new NotSignedIn();
    res = await rpc(token, method, params, timeoutMs);
    if (res.status === 401) throw new NotSignedIn();
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new ToolError(`Geniffy answered HTTP ${res.status}.`);
  if (body.error) throw new ToolError(body.error.message || "Geniffy refused the call.");
  return body.result;
}

export async function tool(name, args = {}, opts) {
  const result = await call("tools/call", { name, arguments: args }, opts);
  if (result.isError) throw new ToolError(result.content?.[0]?.text || `${name} failed.`);
  return result.structuredContent ?? JSON.parse(result.content?.[0]?.text || "{}");
}

export async function fetchWithin(url, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── what is never saved ─────────────────────────────────────────────────────────────────────────────────
// Keys, tokens, passwords and private keys are replaced before anything leaves this computer. Matched by
// shape, so a secret pasted into a prompt is caught whatever it belongs to.
const GONE = "[secret removed]";
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bgnf_(?:live|test|at|rt)_[A-Za-z0-9_-]{12,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{12,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bpypi-[A-Za-z0-9_-]{40,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\brzp_(?:live|test)_[A-Za-z0-9]{8,}/g,
];
const LABELLED = /\b((?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?key|token|auth[_-]?token)["']?\s*[:=]\s*)(["']?)(?!\[secret removed\])([^\s"']{6,})\2/gi;
const URL_PASSWORD = /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^:\s/'"@]+:)[^@\s'"]{3,}@/gi;

export function scrub(text) {
  let out = String(text || "");
  for (const rx of SECRETS) out = out.replace(rx, GONE);
  out = out.replace(LABELLED, (_m, label, q) => `${label}${q}${GONE}${q}`);
  out = out.replace(URL_PASSWORD, (_m, head) => `${head}${GONE}@`);
  return out;
}

// What one exchange becomes before it is saved: code blocks left out (code lives in the repository, and a
// memory is for what was decided), secrets removed, and each side kept short.
const PER_SIDE = 4000;

function tidy(text) {
  const prose = String(text || "").replace(/```[\s\S]*?(?:```|$)/g, "[code left out]");
  const clean = scrub(prose).replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > PER_SIDE ? `${clean.slice(0, PER_SIDE - 1).trimEnd()}…` : clean;
}

// The conversation to save for one turn, or null when there is nothing worth a memory.
export function exchange(prompts, reply) {
  const said = prompts.map(tidy).filter(Boolean).join("\n\n");
  const answer = tidy(reply);
  if (!said || said.replace(/\[code left out\]|\[secret removed\]/g, "").trim().length < 12) return null;
  const messages = [{ role: "user", content: said }];
  if (answer) messages.push({ role: "assistant", content: answer });
  return messages;
}

// ── a whole session ─────────────────────────────────────────────────────────────────────────────────────
// What Claude Code wrote to the session's transcript since the last save, as messages: what the person and Claude
// said, and every tool Claude ran with what came back. Geniffy learns facts only from what was said; the tool turns
// tell it what happened (the episodes, where the project stands, the lessons). Secrets go before anything leaves
// this computer, and a long code block or tool output is kept as its start and its end.
const SAID = 6000, CALL = 400, RESULT = 2000, CODE = 1200;

export function clip(text, n) {
  const s = String(text || "").trim();
  if (s.length <= n) return s;
  const head = Math.floor((n * 2) / 3);
  return `${s.slice(0, head).trimEnd()}\n[… ${s.length - n} characters cut …]\n${s.slice(s.length - (n - head)).trimStart()}`;
}

function said(text) {
  const plain = String(text || "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  const code = plain.replace(/```[\s\S]*?(?:```|$)/g, (block) => clip(block, CODE));
  return clip(scrub(code).replace(/\n{3,}/g, "\n\n"), SAID);
}

function blocksText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text : b?.type === "image" ? "[image]" : ""))
    .filter(Boolean).join("\n");
}

function compact(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Claude Code's own lines about slash commands, not something anyone said.
const NOISE = /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr)>|^Caveat: The messages below/;

// Geniffy's own memory tools: what they bring back is the memory itself, so it is never saved back into it.
const OWN = /^mcp__plugin_geniffy_memory__|^mcp__geniffy__/;

export function sessionMessages(lines) {
  const names = new Map();
  const out = [];
  lines.forEach((line, i) => {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (!e || e.isSidechain || e.isMeta || (e.type !== "user" && e.type !== "assistant") || !e.message) return;
    const add = (m) => out.push({ ...m, ...(typeof e.timestamp === "string" ? { time: e.timestamp } : {}), line: i });
    const content = e.message.content;
    if (e.type === "user") {
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
      for (const b of blocks) {
        if (b?.type === "text" && !NOISE.test(b.text || "")) {
          const t = said(b.text);
          if (t) add({ role: "user", content: t });
        } else if (b?.type === "tool_result" && !OWN.test(names.get(b.tool_use_id) || "")) {
          const t = clip(scrub(blocksText(b.content)), RESULT) || "(no output)";
          add({ role: "tool", name: names.get(b.tool_use_id) || "tool", content: b.is_error ? `Failed: ${t}` : t });
        }
      }
      return;
    }
    for (const b of Array.isArray(content) ? content : [{ type: "text", text: String(content || "") }]) {
      if (b?.type === "text") {
        const t = said(b.text);
        if (t) add({ role: "assistant", content: t });
      } else if (b?.type === "tool_use") {
        names.set(b.id, b.name || "tool");
        if (OWN.test(b.name || "")) continue;
        add({ role: "tool_call", name: b.name || "tool", content: clip(scrub(compact(b.input ?? "")), CALL) || "(no input)" });
      }
    }
  });
  return out;
}

// The transcript lines not saved yet: from where this session's last save stopped. A line still being written
// (no newline yet) waits for the next save.
const cursorFile = (sessionId) => path.join("cursors", `${String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

export function unsaved(sessionId, transcriptPath) {
  let text;
  try {
    text = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n").slice(0, -1);
  let from = Number(readJson(cursorFile(sessionId))?.line) || 0;
  if (from > lines.length) from = 0; // the transcript was written anew
  return { from, lines: lines.slice(from), upTo: lines.length };
}

export const markSaved = (sessionId, line) => writeJson(cursorFile(sessionId), { line, at: new Date().toISOString() });

// Calls the memory server takes in one go: at most 300 messages and 200,000 characters each.
export function batches(messages, most = 300, chars = 200_000) {
  const out = [];
  let cur = [], size = 0;
  for (const m of messages) {
    const n = m.content.length + 50;
    if (cur.length && (cur.length >= most || size + n > chars)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(m);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

// Something worth a memory: anything the person or Claude said beyond a word or two.
export const worthSaving = (messages) =>
  messages.some((m) => (m.role === "user" || m.role === "assistant") && m.content.replace(/\[secret removed\]/g, "").trim().length >= 12);

export function projectName(cwd) {
  return path.basename(path.resolve(cwd || process.cwd())) || "a project";
}

// ── hooks ───────────────────────────────────────────────────────────────────────────────────────────────
export async function hookInput() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export function reply(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// A session's prompts wait here until Claude finishes the turn they belong to.
export const turnFile = (sessionId) => path.join("turns", `${String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
