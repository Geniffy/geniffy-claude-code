---
name: memory
description: Use the user's Geniffy memory. Search it before answering anything about their preferences, past decisions, people, projects or earlier conversations, and save what they explicitly ask you to remember. Never save secrets.
---

# Using the user's Geniffy memory

The Geniffy memory server (`plugin:geniffy:memory`) holds what this user has told AI tools before: in Claude Code,
Claude.ai, ChatGPT, Cursor and other apps. Each memory comes with where and when it was said.

## When to look

- Before answering anything about the user themselves, their preferences, the people they work with, their
  plans, or decisions made earlier, use `search` (or `ask` for a direct question).
- When the user refers to earlier work ("like we did last time", "the approach we agreed on"), search for it.
- The session already starts with a briefing: where the project stands, what is due, the lessons that apply and
  what happened last time. When the task changes, call `briefing` again with the new task as `cue`.
- Search when you need a specific fact the briefing does not hold.

## How to use what you find

- Treat a memory as what the user said, with its date. Newer memories replace older ones.
- If memories disagree, say so, and ask which one holds.
- If nothing supports an answer, say you don't know. Never fill a gap with a guess.
- `fetch` opens a memory with the exact line it came from, when you need to quote it.

## Saving

- Each turn is saved automatically after Claude finishes it, tool calls and results included, unless the user
  paused saving (`/geniffy:pause`). So don't save things again by hand.
- Use `remember` only when the user explicitly asks you to remember something.
- Never save passwords, API keys, tokens or other secrets, even when asked. Say why instead.
- When the user says a memory is wrong, use `correct`. When they ask to forget something, use `forget`.
