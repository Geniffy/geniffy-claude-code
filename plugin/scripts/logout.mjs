// /geniffy:logout. Ends this computer's sign-in with Geniffy and deletes it here. The memory itself is
// untouched.
import { credentials, discover, fetchWithin, removeFile } from "./lib.mjs";

const creds = credentials();
if (!creds) {
  console.log("Not signed in to Geniffy on this computer.");
  process.exit(0);
}
try {
  const meta = await discover();
  if (meta.revocation_endpoint) {
    await fetchWithin(meta.revocation_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: creds.refresh_token, token_type_hint: "refresh_token", client_id: creds.client_id }),
    }, 8000);
  }
} catch {}
removeFile("credentials.json");
removeFile("turns");
console.log("Signed out of Geniffy on this computer, and nothing more is saved from here.");
console.log("Your memory itself is unchanged. To see or erase it, open https://geniffy.com/app.");
