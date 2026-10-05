// /geniffy:status. Whether this computer is signed in, whether saving is on, and what happened last.
import { call, credentials, state } from "./lib.mjs";

const creds = credentials();
if (!creds) {
  console.log("Not signed in to Geniffy. Run /geniffy:login.");
  process.exit(0);
}

let working = true;
try {
  await call("ping", {}, { timeoutMs: 8000 });
} catch (err) {
  working = err.name !== "NotSignedIn" ? null : false;
}
const s = state();
const canWrite = String(creds.scope || "").includes("memory:write");
const since = String(creds.signed_in_at || "").slice(0, 10);

console.log(working === false ? "The sign-in no longer works. Run /geniffy:login again."
  : working === null ? `Signed in to Geniffy${since ? ` since ${since}` : ""}, but Geniffy didn't answer just now.`
  : `Signed in to Geniffy${since ? ` since ${since}` : ""}, ${canWrite ? "reading and saving" : "reading only"}.`);
console.log(!canWrite ? "Saving: off (this sign-in allows reading only)."
  : s.paused ? "Saving: paused. /geniffy:resume turns it back on." : "Saving: on, after every turn.");
if (s.last_saved_at) console.log(`Last saved: ${s.last_saved_at.replace("T", " ").slice(0, 16)} UTC, from ${s.last_saved_project}.`);
if (s.last_error) console.log(`Last problem: ${s.last_error}`);
