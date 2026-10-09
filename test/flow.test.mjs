// Every script the plugin runs, run the way Claude Code runs them (a child process, the hook's JSON on stdin)
// against a stand-in Geniffy: signing in, recalling at the start of a session, saving each turn with secrets
// and code left out, refreshing under contention, pausing, reading only, and signing out.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startFake } from "./fake-geniffy.mjs";

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugin", "scripts");

function run(script, { input = {}, args = [], env, onStdout } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; onStdout?.(out); });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(JSON.stringify(input));
  });
}

async function setup(opts) {
  const fake = await startFake(opts);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "geniffy-cc-"));
  const env = { ...process.env, GENIFFY_API_URL: fake.base, GENIFFY_PLUGIN_HOME: home, GENIFFY_NO_BROWSER: "1" };
  const creds = () => JSON.parse(fs.readFileSync(path.join(home, "credentials.json"), "utf8"));
  return { fake, home, env, creds };
}

// Signs in as a person would: login prints the address, the "browser" follows it, Geniffy answers the
// listener on 127.0.0.1, and login exchanges the code.
async function login(env) {
  let opened = false;
  const done = run("login.mjs", {
    env,
    onStdout: (out) => {
      const m = out.match(/https?:\/\/\S+\/oauth\/authorize\S+/);
      if (m && !opened) {
        opened = true;
        fetch(m[0]).catch(() => {});
      }
    },
  });
  return done;
}

const project = path.join(os.tmpdir(), "demo-app");

test("signing in, recalling, saving, refreshing and signing out", async () => {
  const { fake, home, env, creds } = await setup();
  try {
    // Signed out: a reminder once a day, and the memory server gets no credential.
    const first = JSON.parse((await run("session-start.mjs", { env, input: { cwd: project, source: "startup" } })).out);
    assert.match(first.systemMessage, /\/geniffy:login/);
    assert.match(first.hookSpecificOutput.additionalContext, /not signed in/);
    const again = JSON.parse((await run("session-start.mjs", { env, input: { cwd: project } })).out);
    assert.equal(again.systemMessage, undefined, "the reminder shows once a day, not every session");
    assert.deepEqual(JSON.parse((await run("headers.mjs", { env })).out), {});

    // Sign in.
    const signed = await login(env);
    assert.equal(signed.code, 0, signed.out);
    assert.match(signed.out, /Signed in to Geniffy\./);
    const c = creds();
    assert.ok(c.access_token.startsWith("gnf_at_") && c.refresh_token.startsWith("gnf_rt_") && c.client_id);
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(home, "credentials.json")).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse((await run("headers.mjs", { env })).out), { Authorization: `Bearer ${c.access_token}` });

    // The session starts knowing the person and this project, and nothing from elsewhere.
    const start = JSON.parse((await run("session-start.mjs", { env, input: { cwd: project, source: "startup" } })).out);
    const ctx = start.hookSpecificOutput.additionalContext;
    assert.match(ctx, /Prefers pnpm to npm\./);
    assert.match(ctx, /Shipping the Claude Code plugin\./);
    assert.match(ctx, /From earlier work on demo-app:\n- The demo-app API is written in Go.  \(2026-10-01\)/);
    assert.doesNotMatch(ctx, /Lunch is at one/, "a search hit that is not about this project stays out");
    assert.match(ctx, /say so instead of guessing/);
    assert.equal(start.systemMessage, "Geniffy recalled 3 memories for this session.");

    // A turn: two prompts (one a slash command, which is not saved), then Claude's reply.
    await run("prompt.mjs", { env, input: { session_id: "s1", cwd: project, prompt: "/geniffy:status" } });
    await run("prompt.mjs", { env, input: { session_id: "s1", cwd: project,
      prompt: "We always deploy on Tuesdays. Use key " + "sk-" + "ant-abcdefghijklmnop1234" + " and password: hunter2hunter2" } });
    await run("capture.mjs", { env, input: { session_id: "s1", cwd: project,
      last_assistant_message: "Noted, Tuesday deploys.\n```js\nconsole.log('deploy')\n```\nDone." } });
    assert.equal(fake.s.remembered.length, 1);
    const saved = fake.s.remembered[0];
    assert.equal(saved.title, "Claude Code: demo-app");
    assert.equal(saved.session, "s1", "every turn of a session goes into one note for the session");
    assert.equal(saved.messages[0].role, "user");
    assert.match(saved.messages[0].content, /We always deploy on Tuesdays\./);
    assert.doesNotMatch(JSON.stringify(saved), /sk-ant-|hunter2|\/geniffy:status/);
    assert.match(saved.messages[0].content, /\[secret removed\].*password: \[secret removed\]/);
    assert.equal(saved.messages[1].content, "Noted, Tuesday deploys.\n[code left out]\nDone.");
    assert.ok(!fs.existsSync(path.join(home, "turns", "s1.json")), "a saved turn leaves nothing behind");

    // A turn with nothing in it is not saved.
    await run("prompt.mjs", { env, input: { session_id: "s2", cwd: project, prompt: "ok" } });
    await run("capture.mjs", { env, input: { session_id: "s2", cwd: project, last_assistant_message: "Okay." } });
    assert.equal(fake.s.remembered.length, 1);

    // An expired token, needed by five processes at once: one refresh, and the sign-in survives.
    fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ ...creds(), expires_at: Date.now() - 1000 }));
    const before = fake.s.refreshCalls;
    const heads = await Promise.all(Array.from({ length: 5 }, () => run("headers.mjs", { env })));
    assert.equal(fake.s.refreshCalls - before, 1, "only one of them refreshed");
    assert.equal(fake.s.ended, false, "so the refresh token was never used twice");
    const fresh = creds().access_token;
    for (const h of heads) assert.deepEqual(JSON.parse(h.out), { Authorization: `Bearer ${fresh}` });

    // A token the server stops accepting early is refreshed once and the call goes through.
    fake.s.access.delete(fresh);
    const status = await run("status.mjs", { env });
    assert.match(status.out, /Signed in to Geniffy since \d{4}-\d{2}-\d{2}, reading and saving\./);
    assert.match(status.out, /Last saved: .* from demo-app\./);

    // Paused: recall goes on, saving stops; resumed: it saves again.
    assert.match((await run("pause.mjs", { env, args: ["on"] })).out, /paused/);
    await run("prompt.mjs", { env, input: { session_id: "s3", cwd: project, prompt: "Our staging database is in Pune." } });
    await run("capture.mjs", { env, input: { session_id: "s3", cwd: project, last_assistant_message: "Got it." } });
    assert.equal(fake.s.remembered.length, 1);
    assert.match((await run("status.mjs", { env })).out, /Saving: paused/);
    await run("pause.mjs", { env, args: ["off"] });
    await run("prompt.mjs", { env, input: { session_id: "s3", cwd: project, prompt: "Our staging database is in Pune." } });
    await run("capture.mjs", { env, input: { session_id: "s3", cwd: project, last_assistant_message: "Got it." } });
    assert.equal(fake.s.remembered.length, 2);

    // Signing out ends the sign-in at Geniffy and deletes it here.
    const { refresh_token: refreshToken, client_id: clientId } = creds();
    assert.match((await run("logout.mjs", { env })).out, /Signed out of Geniffy/);
    assert.deepEqual(fake.s.revoked.at(-1), { token: refreshToken, token_type_hint: "refresh_token", client_id: clientId });
    assert.ok(!fs.existsSync(path.join(home, "credentials.json")));
    assert.match((await run("status.mjs", { env })).out, /Not signed in/);
  } finally {
    await fake.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a sign-in Geniffy has ended is noticed and cleared", async () => {
  const { fake, home, env } = await setup();
  try {
    assert.equal((await login(env)).code, 0);
    fake.s.ended = true;
    const c = JSON.parse(fs.readFileSync(path.join(home, "credentials.json"), "utf8"));
    fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({ ...c, expires_at: Date.now() - 1000 }));
    assert.deepEqual(JSON.parse((await run("headers.mjs", { env })).out), {});
    assert.ok(!fs.existsSync(path.join(home, "credentials.json")), "a refused refresh token means signed out");
    const start = JSON.parse((await run("session-start.mjs", { env, input: { cwd: project } })).out);
    assert.match(start.hookSpecificOutput.additionalContext, /not signed in/);
  } finally {
    await fake.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("reading only, and saying no", async () => {
  const { fake, home, env } = await setup({ scope: "memory:read" });
  try {
    const signed = await login(env);
    assert.match(signed.out, /reading only/);
    await run("prompt.mjs", { env, input: { session_id: "r1", cwd: project, prompt: "Remember that I like tea." } });
    await run("capture.mjs", { env, input: { session_id: "r1", cwd: project, last_assistant_message: "Noted." } });
    assert.equal(fake.s.remembered.length, 0, "a read-only sign-in never saves");
    assert.match((await run("status.mjs", { env })).out, /Saving: off/);
    fs.rmSync(path.join(home, "credentials.json"));
    fake.s.deny = true;
    const denied = await login(env);
    assert.equal(denied.code, 1);
    assert.match(denied.out, /You chose not to connect/);
    assert.ok(!fs.existsSync(path.join(home, "credentials.json")));
  } finally {
    await fake.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
