// SessionStart: Claude starts each session knowing what Geniffy remembers about the person and this project.
// Kept short, because it is read at the start of every session, and quiet when there is nothing to say.
import { credentials, hookInput, projectName, reply, setState, state, sweepTurns, tool } from "./lib.mjs";

const input = await hookInput();
const project = projectName(input.cwd);
sweepTurns();

function signedOut() {
  const today = new Date().toISOString().slice(0, 10);
  const out = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: "The Geniffy memory plugin is installed but not signed in, so nothing is remembered yet. " +
        "If the user asks about memory, suggest /geniffy:login.",
    },
  };
  if (state().reminded_on !== today) {
    out.systemMessage = "Geniffy memory is not signed in yet. Run /geniffy:login to connect it.";
    setState({ reminded_on: today });
  }
  reply(out);
}

if (!credentials()) {
  signedOut();
  process.exit(0);
}

const words = (item) => (typeof item === "string" ? item : item?.value || item?.text || "").trim();
const when = (m) => String(m.said_at || m.learned_at || "").slice(0, 10);

const [profile, found] = await Promise.allSettled([
  tool("profile", {}, { timeoutMs: 6000 }),
  tool("search", { query: project, limit: 10 }, { timeoutMs: 6000 }),
]);
if ([profile, found].some((r) => r.status === "rejected" && r.reason?.name === "NotSignedIn") && !credentials()) {
  signedOut();
  process.exit(0);
}

const lasting = profile.status === "fulfilled" ? (profile.value.lasting || []).map(words).filter(Boolean).slice(0, 8) : [];
const current = profile.status === "fulfilled" ? (profile.value.current || []).map(words).filter(Boolean).slice(0, 5) : [];
// Search ranks without judging, so only what belongs to this project is kept: memories saved from its own
// sessions, or ones that name it.
const named = new RegExp(`\\b${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
const projectMemories = found.status === "fulfilled"
  ? (found.value.results || []).filter((m) => named.test(m.text || "") || named.test(m.source?.title || "")).slice(0, 6)
  : [];

const lines = [];
if (lasting.length) lines.push("What lasts:", ...lasting.map((t) => `- ${t}`));
if (current.length) lines.push("What is going on now:", ...current.map((t) => `- ${t}`));
if (projectMemories.length) {
  lines.push(`From earlier work on ${project}:`,
             ...projectMemories.map((m) => `- ${m.text}${when(m) ? `  (${when(m)})` : ""}`));
}

const total = lasting.length + current.length + projectMemories.length;
const intro = "You have this user's Geniffy memory: what they told AI tools before, each memory from a real source. " +
  "Use it when it helps and don't recite it. When it doesn't cover something, say so instead of guessing. " +
  "The memory tools can search for more.";
reply({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: total
      ? `${intro}\n\n${lines.join("\n")}`.slice(0, 2400)
      : `This user's Geniffy memory is connected, and holds nothing yet about them or ${project}. It learns from this session.`,
  },
  ...(total ? { systemMessage: `Geniffy recalled ${total} ${total === 1 ? "memory" : "memories"} for this session.` } : {}),
});
