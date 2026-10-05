// The MCP headers helper. Claude Code runs it when it connects to the Geniffy memory server and puts what it
// prints on that connection: this computer's Geniffy sign-in, refreshed when it needs to be, or nothing when
// signed out. One sign-in then serves both the memory tools and the hooks.
import { accessToken } from "./lib.mjs";

let token = null;
try {
  token = await accessToken();
} catch {}
process.stdout.write(JSON.stringify(token ? { Authorization: `Bearer ${token}` } : {}));
