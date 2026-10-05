// /geniffy:pause and /geniffy:resume. Stops or restarts saving; recall at the start of a session goes on.
import { removeFile, setState } from "./lib.mjs";

const pause = process.argv[2] !== "off";
setState({ paused: pause });
if (pause) removeFile("turns");
console.log(pause ? "Saving to Geniffy is paused. Sessions still start with what it remembers. /geniffy:resume turns saving back on."
  : "Saving to Geniffy is back on, after every turn.");
