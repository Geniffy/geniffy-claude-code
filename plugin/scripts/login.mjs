// /geniffy:login. Signs this computer in to Geniffy in the browser: the same sign-in Claude.ai and ChatGPT use
// (OAuth with PKCE), answered by a short-lived listener on 127.0.0.1. Nothing to copy, and no key to keep.
import { randomBytes } from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { MCP_URL, SCOPES, discover, fetchWithin, pkce, writeJson } from "./lib.mjs";

const WAIT_MS = 5 * 60_000;

function fail(message) {
  console.log(message);
  process.exit(1);
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {}
}

const page = (title, line) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${title}</title><body style="font:16px/1.5 system-ui,sans-serif;background:#fafaf8;color:#1a1814;display:grid;place-items:center;min-height:90vh;margin:0">
<main style="max-width:26rem;padding:2rem"><h1 style="font-size:1.4rem;margin:0 0 .5rem">${title}</h1><p style="margin:0;color:#5e574c">${line}</p></main>`;

let meta;
try {
  meta = await discover();
} catch (err) {
  fail(err.message);
}

const server = http.createServer();
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

const registered = await fetchWithin(meta.registration_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_name: "Geniffy for Claude Code", redirect_uris: [redirectUri],
                         grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
                         token_endpoint_auth_method: "none", scope: SCOPES }),
}, 10000).catch(() => null);
if (!registered?.ok) fail("Couldn't start the sign-in with Geniffy. Try again in a moment.");
const { client_id: clientId } = await registered.json();

const { verifier, challenge } = pkce();
const expected = randomBytes(16).toString("base64url");
const url = `${meta.authorization_endpoint}?${new URLSearchParams({
  response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: SCOPES, state: expected,
  code_challenge: challenge, code_challenge_method: "S256", resource: MCP_URL,
})}`;

console.log("Opening your browser to sign in to Geniffy.");
console.log(`If it doesn't open, go to:\n${url}\n`);
if (!process.env.GENIFFY_NO_BROWSER) openBrowser(url);

const answer = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), WAIT_MS);
  server.on("request", (req, res) => {
    const q = new URL(req.url, redirectUri).searchParams;
    if (!req.url.startsWith("/callback") || q.get("state") !== expected) {
      res.writeHead(404).end();
      return;
    }
    const ok = q.get("code") && !q.get("error");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(ok
      ? page("Connected", "Your Geniffy memory is connected to Claude Code. You can close this tab.")
      : page("Not connected", "Nothing was shared. You can close this tab."));
    clearTimeout(timer);
    resolve(q);
  });
});
server.close();

if (!answer) fail("The sign-in timed out. Run /geniffy:login to try again.");
if (answer.get("error")) {
  fail(answer.get("error") === "access_denied" ? "You chose not to connect, so nothing was shared."
    : `Geniffy didn't connect: ${answer.get("error_description") || answer.get("error")}.`);
}
if (answer.get("iss") && answer.get("iss") !== meta.issuer) fail("The sign-in answer came from the wrong place, so it was ignored.");

const exchanged = await fetchWithin(meta.token_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code: answer.get("code"), redirect_uri: redirectUri,
                              client_id: clientId, code_verifier: verifier, resource: MCP_URL }),
}, 10000).catch(() => null);
const tokens = exchanged ? await exchanged.json().catch(() => ({})) : {};
if (!exchanged?.ok || !tokens.access_token) fail("Geniffy didn't finish the sign-in. Run /geniffy:login to try again.");

writeJson("credentials.json", {
  issuer: meta.issuer, client_id: clientId, access_token: tokens.access_token, refresh_token: tokens.refresh_token,
  expires_at: Date.now() + (tokens.expires_in || 3600) * 1000, scope: tokens.scope || SCOPES,
  signed_in_at: new Date().toISOString(),
});

const canWrite = String(tokens.scope || SCOPES).includes("memory:write");
console.log("Signed in to Geniffy.");
console.log(canWrite
  ? "Each session now starts with what Geniffy remembers, and what you discuss is saved as you go (/geniffy:pause stops that)."
  : "You allowed reading only, so sessions start with what Geniffy remembers and nothing is saved.");
console.log("For the memory tools in this session, run /mcp and reconnect plugin:geniffy:memory. New sessions connect by themselves.");
