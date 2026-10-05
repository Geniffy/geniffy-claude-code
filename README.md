<p align="center">
  <a href="https://geniffy.com"><img src="https://geniffy.com/brand/geniffy-lockup-ink.png" alt="Geniffy" height="44"></a>
</p>

# Geniffy for Claude Code

Claude Code that remembers you and your projects. Each session starts with what Geniffy knows that matters here,
and what you discuss is saved as you go: every fact with the line it came from, and a plain "nothing stored"
instead of a guess.

[![CI](https://github.com/Geniffy/geniffy-claude-code/actions/workflows/ci.yml/badge.svg)](https://github.com/Geniffy/geniffy-claude-code/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-docs.geniffy.com-1A1814)](https://docs.geniffy.com/mcp/claude-code)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Install

In Claude Code:

```text
/plugin marketplace add Geniffy/geniffy-claude-code
/plugin install geniffy@geniffy
```

Then sign in once:

```text
/geniffy:login
```

Your browser opens on Geniffy. Choose **Allow** and you're done: there is no key to copy. The plugin's hooks run
with Node.js 18 or later, so `node` needs to be on your `PATH`.

## What it does

| When | What happens |
| --- | --- |
| A session starts | Claude gets a short summary: what lasts about you, what is going on now, and what was said before about this project |
| You send a message | It is kept on your computer until Claude finishes the turn |
| Claude finishes a turn | The exchange is saved to Geniffy in the background, who said what kept, so your words become facts about you and Claude's do not |
| Claude needs more | The memory tools that only read (`search`, `ask`, `fetch`, `profile`, `list_memories`) run without asking; saving, correcting and forgetting ask first |

Geniffy learns the facts in each exchange and keeps each one with the line it came from and when it was said. A
newer fact replaces an older one, and when nothing supports an answer, Claude is told to say so.

## Commands

| Command | |
| --- | --- |
| `/geniffy:login` | Sign in (once per computer) |
| `/geniffy:status` | Whether you're signed in, whether saving is on, and what was saved last |
| `/geniffy:pause`, `/geniffy:resume` | Stop or restart saving. Sessions still start with what Geniffy remembers |
| `/geniffy:remember <text>` | Save something on purpose |
| `/geniffy:recall <question>` | Ask your memory, with sources |
| `/geniffy:logout` | Sign out on this computer |

## What stays on your computer

- **Secrets.** API keys, tokens, passwords, connection-string passwords and private keys are removed before anything
  is saved, matched by shape (`sk-…`, `ghp_…`, `AKIA…`, `xoxb-…`, `password: …` and more).
- **Code.** Code blocks are left out: your repository holds your code, and the memory holds what was decided.
- **Commands.** Slash commands aren't saved.
- **Everything, while paused.** `/geniffy:pause` stops saving until you resume.
- **The sign-in itself** lives in `~/.geniffy/claude-code/`, readable only by you. `/geniffy:logout` ends it at
  Geniffy and deletes it here.

## One memory, in every app

This is the same memory you can connect to Claude.ai, ChatGPT, Cursor, VS Code and Codex through the
[Geniffy MCP server](https://github.com/Geniffy/geniffy-mcp). See it, correct it or erase it at
[geniffy.com/app](https://geniffy.com/app). Your memory is stored in India.

## Develop

```bash
npm test                             # node --test, no dependencies
claude plugin validate ./plugin      # Claude Code's own check of the plugin
claude plugin validate .             # and of the marketplace
```

Set `GENIFFY_API_URL` to point the scripts at another Geniffy server, and `GENIFFY_PLUGIN_HOME` to keep their
files somewhere other than `~/.geniffy/claude-code`.

## Security

Report a vulnerability to ops@geniffy.com, not in a public issue. See the
[security policy](https://github.com/Geniffy/.github/blob/main/SECURITY.md).
