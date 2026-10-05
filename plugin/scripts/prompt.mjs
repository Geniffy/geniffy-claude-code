// UserPromptSubmit: keep the prompt until Claude finishes the turn, so the two can be saved together. No
// network and nothing printed, so the prompt goes on exactly as typed.
import { canSave, hookInput, readJson, turnFile, writeJson } from "./lib.mjs";

const input = await hookInput();
const prompt = String(input.prompt || "").trim();
if (prompt && !prompt.startsWith("/") && canSave()) {
  const name = turnFile(input.session_id);
  const turn = readJson(name) || { prompts: [] };
  turn.prompts.push(prompt);
  turn.cwd = input.cwd || turn.cwd;
  writeJson(name, turn);
}
