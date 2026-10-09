# Changelog

## 0.2.0

- Every turn is saved whole: what you and Claude said, and every tool Claude ran with what came back, read from the
  session's transcript. Secrets are removed and long code and output are cut to their start and end before anything
  leaves your computer. Geniffy learns facts only from what was said; the tool turns tell it what happened.
- Only what is new since the last save is sent, and a save that fails is sent with the next one.
- Each session is saved under its project, and opens with Geniffy's briefing for it: where things stand (goal,
  focus, open items, decisions, next steps), what is due, the rules and lessons that apply, what happened last time,
  then the memories. With an older Geniffy, the session opens with your profile and this project's memories, as
  before.

## 0.1.1

- Every turn of a session now goes into one note for the whole session, instead of a new note for each turn. Your memory reads the same; a long session counts by what it says, not as one memory per turn.

## 0.1.0

The first release.

- Sign in once in the browser (`/geniffy:login`); one sign-in serves the memory tools and the hooks.
- Each session starts with what Geniffy remembers about you and the project.
- Each exchange is saved in the background, who said what kept, with secrets and code blocks left out.
- The memory tools that only read run without asking; saving, correcting and forgetting ask first.
- `/geniffy:status`, `/geniffy:pause`, `/geniffy:resume`, `/geniffy:remember`, `/geniffy:recall` and `/geniffy:logout`.
