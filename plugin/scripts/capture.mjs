// Stop, run in the background: when Claude finishes a turn, save it to Geniffy whole. Everything the session's
// transcript gained since the last save goes: what the person and Claude said, and every tool Claude ran with what
// came back, secrets removed and long code and output cut short. Geniffy learns facts only from what was said; the
// tool turns tell it what happened, so the next session can pick up where this one stands. Every turn of a session
// goes into one note for the whole session (its id is sent along), under the project it was in. Without a
// transcript (an older Claude Code), the turn's prompts and Claude's last reply go, as before.
import {
  batches, canSave, exchange, hookInput, markSaved, projectName, readJson, removeFile, sessionMessages, setState, tool,
  turnFile, unsaved, worthSaving,
} from "./lib.mjs";

const input = await hookInput();
const name = turnFile(input.session_id);
const turn = readJson(name);
removeFile(name);

const session = input.session_id ? String(input.session_id).slice(0, 200) : null;
if (!canSave()) {
  // paused, signed out, or allowed to read only: what happened meanwhile is never sent, not even later
  const skipped = session && input.transcript_path ? unsaved(session, input.transcript_path) : null;
  if (skipped) markSaved(session, skipped.upTo);
} else {
  const project = projectName(input.cwd || turn?.cwd);
  const fresh = session && input.transcript_path ? unsaved(session, input.transcript_path) : null;
  const messages = fresh ? sessionMessages(fresh.lines)
    : turn ? (exchange(turn.prompts || [], input.last_assistant_message) || []) : [];
  try {
    if (messages.length && worthSaving(messages)) {
      const parts = batches(messages);
      for (const [i, part] of parts.entries()) {
        const args = { messages: part.map(({ line, ...m }) => m), title: `Claude Code: ${project}`, project };
        if (session) args.session = session;
        await tool("remember", args, { timeoutMs: 30000 });
        // saved up to the first line the next part starts with: after a failure, only what is left goes again
        if (fresh) markSaved(session, fresh.from + (i + 1 < parts.length ? parts[i + 1][0].line : fresh.lines.length));
      }
      setState({ last_saved_at: new Date().toISOString(), last_saved_project: project, last_error: null });
    } else if (fresh) {
      markSaved(session, fresh.upTo); // nothing worth a memory: not read again
    }
  } catch (err) {
    setState({ last_error: `${new Date().toISOString()} ${err.message}` });
  }
}
