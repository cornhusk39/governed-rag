// AgentProbe configuration for the Governed RAG eval gate.
//
// This is a REPLAY-ONLY config: no liveAgent and no recordJudge. CI clones the
// public AgentProbe repo, builds it, and runs its CLI against this config, which
// replays the committed cassettes and diffs them against the committed baseline.
//
// It is plain ESM (.mjs) on purpose: AgentProbe is cloned into a separate
// directory and built to dist, then run under plain `node`, which can import a
// .mjs config natively without a TypeScript loader. AgentProbe's loader reads the
// default export as a plain object. Paths resolve from this file's location, so
// the cwd does not matter.

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  suiteFile: path.join(here, "suite.json"),
  cassetteDir: path.join(here, "cassettes"),
  judgeCacheFile: path.join(here, "judge-cache.json"),
  baselineFile: path.join(here, "baseline.json"),
  dbPath: process.env.AGENTPROBE_DB_PATH ?? path.join(here, "data", "agentprobe.db"),
};
