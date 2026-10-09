// A whole session, the way Claude Code writes it to its transcript: each turn is saved whole (what was said, every
// tool call and what came back), secrets removed, long output cut, only what is new since the last save, under the
// project it was in; and the next session opens with Geniffy's briefing for that project.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startFake } from "./fake-geniffy.mjs";

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plugin", "scripts");
const project = path.join(os.tmpdir(), "demo-app");

function run(script, { input = {}, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script)], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(JSON.stringify(input));
  });
}

// A signed-in plugin, without the browser: the fake's tokens are issued as its sign-in would.
async function signedIn() {
  const fake = await startFake();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "geniffy-cc-s-"));
  const env = { ...process.env, GENIFFY_API_URL: fake.base, GENIFFY_PLUGIN_HOME: home, GENIFFY_NO_BROWSER: "1" };
  const access = "gnf_at_test";
  fake.s.access.set(access, { exp: Date.now() + 3600_000, family: "f" });
  fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({
    access_token: access, refresh_token: "gnf_rt_test", client_id: "c", expires_at: Date.now() + 3600_000,
    scope: "memory:read memory:write" }));
  return { fake, home, env };
}

const line = (o) => JSON.stringify(o) + "\n";
const at = (n) => `2026-10-08T21:${String(n).padStart(2, "0")}:00.000Z`;
const LOG = Array.from({ length: 400 }, (_, i) => `test ${i} ok`).join("\n");

test("each turn is saved whole from the transcript, only what is new, and the next session is briefed", async () => {
  const { fake, home, env } = await signedIn();
  const transcript = path.join(home, "session.jsonl");
  try {
    fs.writeFileSync(transcript,
      line({ type: "user", timestamp: at(1), message: { role: "user", content: "<command-name>/geniffy:status</command-name>" } }) +
      line({ type: "user", timestamp: at(2), message: { role: "user", content: "Run the upload tests. We deploy on Tuesdays." } }) +
      line({ type: "assistant", timestamp: at(3), message: { role: "assistant", content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "Running them." },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test -- upload" } }] } }) +
      line({ type: "user", timestamp: at(4), message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "FAIL upload: cut at 60 s\n" + LOG }] }] } }) +
      line({ type: "assistant", isSidechain: true, timestamp: at(4), message: { role: "assistant", content: [{ type: "text", text: "a subagent's own work" }] } }) +
      line({ type: "assistant", timestamp: at(5), message: { role: "assistant", content: [
        { type: "text", text: "The upload test fails at 60 seconds. Key " + "sk-" + "ant-abcdefghijklmnop1234 is in the env." }] } }));
    const input = { session_id: "s9", cwd: project, transcript_path: transcript };
    await run("capture.mjs", { env, input });
    assert.equal(fake.s.remembered.length, 1);
    const saved = fake.s.remembered[0];
    assert.equal(saved.session, "s9");
    assert.equal(saved.project, "demo-app", "where things stand is kept per project");
    assert.deepEqual(saved.messages.map((m) => [m.role, m.name || ""]), [
      ["user", ""], ["assistant", ""], ["tool_call", "Bash"], ["tool", "Bash"], ["assistant", ""]]);
    assert.equal(saved.messages[2].content, '{"command":"npm test -- upload"}');
    const out = saved.messages[3].content;
    assert.ok(out.startsWith("FAIL upload: cut at 60 s") && out.includes("characters cut") && out.length < 2100,
              "a long output is kept as its start and its end");
    assert.equal(saved.messages[0].time, at(2), "each turn keeps its time");
    assert.doesNotMatch(JSON.stringify(saved), /sk-ant-|private|subagent|geniffy:status/);

    // The next turn: only the new lines go. A line still being written waits.
    fs.appendFileSync(transcript,
      line({ type: "user", timestamp: at(6), message: { role: "user", content: "Then raise the limit to 120 seconds." } }) +
      JSON.stringify({ type: "assistant", timestamp: at(7), message: { role: "assistant", content: [{ type: "text", text: "Raising the limit to 120 seconds now." }] } }));
    await run("capture.mjs", { env, input });
    assert.equal(fake.s.remembered.length, 2);
    assert.deepEqual(fake.s.remembered[1].messages.map((m) => m.content), ["Then raise the limit to 120 seconds."]);
    fs.appendFileSync(transcript, "\n");
    await run("capture.mjs", { env, input });
    assert.deepEqual(fake.s.remembered[2].messages.map((m) => m.content), ["Raising the limit to 120 seconds now."]);
    await run("capture.mjs", { env, input });
    assert.equal(fake.s.remembered.length, 3, "nothing new, nothing sent");

    // The next session opens with the briefing for the project.
    fake.s.briefing = {
      project: "demo-app", briefing: "Where things stand (demo-app):\n- Focus: the upload limit\n- Next: raise it to 120 s",
      now: [{ project: "demo-app" }], due: [{ id: 1 }], lessons: [], episodes: [{ id: 1 }, { id: 2 }], memories: [{ id: "memory:1" }] };
    const start = JSON.parse((await run("session-start.mjs", { env, input: { cwd: project, source: "startup" } })).out);
    assert.match(start.hookSpecificOutput.additionalContext, /Where things stand \(demo-app\):\n- Focus: the upload limit/);
    assert.equal(start.systemMessage,
                 "Geniffy briefed you: where things stand, 1 due, 2 earlier episodes, 1 memory for this session.");
    assert.deepEqual(fake.s.briefed[0], { project: "demo-app", budget_chars: 5000 });
  } finally {
    await fake.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("what happens while paused is never sent, and a save that fails is sent next time", async () => {
  const { fake, home, env } = await signedIn();
  const transcript = path.join(home, "session.jsonl");
  try {
    fs.writeFileSync(transcript, line({ type: "user", timestamp: at(1), message: { role: "user", content: "Our staging database is in Pune." } }));
    const input = { session_id: "p1", cwd: project, transcript_path: transcript };
    fs.writeFileSync(path.join(home, "state.json"), JSON.stringify({ paused: true }));
    await run("capture.mjs", { env, input });
    assert.equal(fake.s.remembered.length, 0, "paused: nothing leaves this computer");
    fs.writeFileSync(path.join(home, "state.json"), JSON.stringify({ paused: false }));
    fs.appendFileSync(transcript, line({ type: "user", timestamp: at(2), message: { role: "user", content: "The release goes out on Friday." } }));
    fake.s.access.clear();      // the server refuses the sign-in: the save fails
    fake.s.ended = true;
    await run("capture.mjs", { env, input });
    assert.equal(fake.s.remembered.length, 0);
    fake.s.ended = false;
    fake.s.access.set("gnf_at_test", { exp: Date.now() + 3600_000, family: "f" });
    fs.writeFileSync(path.join(home, "credentials.json"), JSON.stringify({
      access_token: "gnf_at_test", refresh_token: "gnf_rt_test", client_id: "c", expires_at: Date.now() + 3600_000,
      scope: "memory:read memory:write" }));
    await run("capture.mjs", { env, input });
    assert.equal(fake.s.remembered.length, 1, "what failed goes with the next save");
    assert.deepEqual(fake.s.remembered[0].messages.map((m) => m.content), ["The release goes out on Friday."],
                     "and what was said while paused never goes");
  } finally {
    await fake.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
