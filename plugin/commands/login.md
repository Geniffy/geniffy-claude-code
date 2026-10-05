---
description: Sign in to Geniffy, so Claude remembers you and your projects across sessions
allowed-tools: Bash(node:*)
---
Run this command with the Bash tool and a timeout of 300000 ms. It opens the user's browser and waits while they sign in, so let it finish:

node "${CLAUDE_PLUGIN_ROOT}/scripts/login.mjs"

Then tell the user what it printed, in a sentence or two, including the line about /mcp if it printed one.
