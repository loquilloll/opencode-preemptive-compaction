# opencode-preemptive-compaction

A standalone [OpenCode](https://opencode.ai) plugin that **proactively compacts sessions before they hit the model's context limit**, instead of waiting for OpenCode's reactive overflow compaction.

Extracted from [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (formerly `oh-my-opencode`) and stripped of every OmO-only dependency so it runs as a single, self-contained hook.

## What it does

- Listens to `message.updated`, caching each assistant turn's token usage (`input` + `cache.read`) per session.
- After every `tool.execute.after`, checks the cached usage against the model's real context limit.
- When usage crosses the threshold (default **78%**), it calls `client.session.summarize` to compact the session **before** the model errors out.
- Cooldown + in-progress guards prevent compaction storms or duplicate runs.
- **Post-compaction degradation monitor**: after a compaction, watches the next assistant turns; if it detects repeated "no-text tail" responses (a known compaction-corruption symptom), it automatically re-runs compaction to recover.
- Cleans up all per-session state on `session.deleted`.

## Install

### Option A — local plugin

Copy `src/index.ts` (or this whole folder) into your plugin directory:

- Project: `.opencode/plugins/preemptive-compaction.ts`
- Global: `~/.config/opencode/plugins/preemptive-compaction.ts`

OpenCode auto-loads every `.ts`/`.js` file in those directories. The default export is the plugin.

### Option B — single-file bundle (recommended for local use)

Build a self-contained drop-in file (no runtime deps) and drop it into your plugin dir:

```sh
bun run build
# -> dist/preemptive-compaction.plugin.js  (~20 KB, single default export, fully inlined)
cp dist/preemptive-compaction.plugin.js ~/.config/opencode/plugins/preemptive-compaction.js
# or, project-scoped: .opencode/plugins/preemptive-compaction.js
```

> The drop-in bundles `src/plugin.ts`, which exports **only** the plugin function as the
> default export. OpenCode's local-plugin loader rejects modules with non-function named
> exports, so do not bundle `src/index.ts` (the full public API) as a local plugin — use it
> only for npm/programmatic consumption.

OpenCode auto-loads every `.ts`/`.js` file in those directories. The default export is the plugin.

### Option C — from source (development)

```sh
bun install
bun test          # 55 tests
bun run typecheck # tsc --noEmit
```

### Option D — npm package (once published)

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-preemptive-compaction"]
}
```

## Configuration

All configuration is via environment variables (read at plugin load). Defaults match the original OmO behavior.

| Env var | Default | Description |
| --- | --- | --- |
| `PREEMPTIVE_COMPACTION_ENABLED` | `true` | Master switch. Set `false` to disable. |
| `PREEMPTIVE_COMPACTION_THRESHOLD` | `0.78` | Usage ratio that triggers compaction. Clamped to `0.5`–`0.95`. |
| `PREEMPTIVE_COMPACTION_COOLDOWN_MS` | `60000` | Minimum time between compaction attempts per session. |
| `PREEMPTIVE_COMPACTION_TIMEOUT_MS` | `60000` | Abort the `summarize` call after this long. |
| `PREEMPTIVE_COMPACTION_MODEL` | _unset_ | Override the model used for compaction, e.g. `opencode/glm-4.6`. Falls back to the session's model. |
| `PREEMPTIVE_COMPACTION_MONITOR_ENABLED` | `true` | Enable the post-compaction degradation/recovery monitor. |
| `PREEMPTIVE_COMPACTION_MONITOR_COUNT` | `5` | Assistant turns to observe after a compaction. |
| `PREEMPTIVE_COMPACTION_MONITOR_NO_TEXT_THRESHOLD` | `3` | Consecutive no-text tails that trigger recovery compaction. |
| `PREEMPTIVE_COMPACTION_MONITOR_SUPPRESSION_MS` | `5000` | Window during which a recovery-triggered compaction is not re-armed. |
| `PREEMPTIVE_COMPACTION_MONITOR_MAX_RECOVERY` | `3` | Max recovery attempts before giving up. |
| `PREEMPTIVE_COMPACTION_MONITOR_TIMEOUT_MS` | `120000` | Timeout for recovery `summarize` calls. |
| `ANTHROPIC_1M_CONTEXT` | _unset_ | Treat Anthropic models as having the 1M context window. |
| `VERTEX_ANTHROPIC_1M_CONTEXT` | _unset_ | Same, for the Vertex Anthropic provider. |
| `PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON` | _unset_ | JSON map of `"<provider>/<model>": <limit>` for non-Anthropic models, e.g. `{"opencode/kimi-k2.5-free":262144}`. |

### Context-limit resolution

The hook must know each model's true context limit to compute the usage ratio:

- **Anthropic** providers (`anthropic`, `google-vertex-anthropic`, `aws-bedrock-anthropic`, and `google` + `claude-*`): 1M for GA models (`claude-(opus|sonnet)-4.6/4.7/4.8`, `claude-fable-5`, `claude-mythos-5`), else 200k. The `ANTHROPIC_1M_CONTEXT`/`VERTEX_ANTHROPIC_1M_CONTEXT` env vars or the internal `anthropicContext1MEnabled` flag force 1M.
- **Other providers**: looked up in the model-limits map (env `PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON`). Unknown models return `null` and compaction is **skipped** (safe default — never compact when the limit is unknown).

## How it maps to the original OmO hook

| OmO source path | This repo |
| --- | --- |
| `hooks/preemptive-compaction.ts` | `src/preemptive-compaction.ts` |
| `hooks/preemptive-compaction-trigger.ts` | `src/preemptive-compaction-trigger.ts` |
| `hooks/preemptive-compaction-types.ts` | `src/preemptive-compaction-types.ts` |
| `hooks/preemptive-compaction-no-text-tail.ts` | `src/preemptive-compaction-no-text-tail.ts` |
| `hooks/preemptive-compaction-degradation-monitor.ts` | `src/preemptive-compaction-degradation-monitor.ts` |
| `hooks/shared/compaction-model-resolver.ts` | `src/internal/compaction-model-resolver.ts` (simplified) |
| `@oh-my-opencode/model-core` context-limit-resolver | `src/internal/context-limit-resolver.ts` (inlined) |
| `shared/compaction-marker.ts` (`isCompactionAgent`) | `src/internal/compaction-marker.ts` |
| `shared/event-session-id.ts` | `src/internal/event-session-id.ts` |
| `shared/normalize-sdk-response.ts` | `src/internal/normalize-sdk-response.ts` |
| `shared/logger.ts` | `src/internal/logger.ts` (routes through `client.app.log`) |
| OmO plugin config (`experimental.preemptive_compaction`) | `src/config.ts` (env-driven) |

The OmO `resolveCompactionModel` read a per-agent `compaction.model` from the OmO agent config; here it reads a single `PREEMPTIVE_COMPACTION_MODEL` override. All other logic is ported verbatim.

## Programmatic use

```ts
import { createPreemptiveCompactionHook, DEFAULT_CONFIG } from "opencode-preemptive-compaction"

const hook = createPreemptiveCompactionHook(
  { client, directory },
  { ...DEFAULT_CONFIG, threshold: 0.7 },
)
// hook["tool.execute.after"]  -> (input, output) => Promise<void>
// hook.event                  -> ({ event }) => Promise<void>
```

## License

Source logic is derived from oh-my-openagent (SUL-1.0).
