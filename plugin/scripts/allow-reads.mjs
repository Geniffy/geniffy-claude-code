// PreToolUse for the memory tools that only read: they run without asking. Saving, correcting and
// forgetting still ask, so nothing changes the memory without the person seeing it.
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: "Reading your Geniffy memory",
  },
}));
