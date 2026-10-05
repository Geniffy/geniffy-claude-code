// Stop, run in the background: when Claude finishes a turn, save what was said in it to Geniffy, who said
// what kept, secrets and code left out. Geniffy learns the facts in it; nothing here waits for that.
import { canSave, exchange, hookInput, projectName, readJson, removeFile, setState, tool, turnFile } from "./lib.mjs";

const input = await hookInput();
const name = turnFile(input.session_id);
const turn = readJson(name);
removeFile(name);

const messages = turn && canSave() ? exchange(turn.prompts || [], input.last_assistant_message) : null;
if (messages) {
  const project = projectName(turn.cwd || input.cwd);
  try {
    await tool("remember", { messages, title: `Claude Code: ${project}` }, { timeoutMs: 20000 });
    setState({ last_saved_at: new Date().toISOString(), last_saved_project: project, last_error: null });
  } catch (err) {
    setState({ last_error: `${new Date().toISOString()} ${err.message}` });
  }
}
