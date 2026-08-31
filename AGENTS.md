# AGENTS.md

Guidance for AI agents working in this repo.

## What this is

A standalone OpenCode plugin that performs **preemptive session compaction**. It was
extracted from `oh-my-openagent` (the `preemptive-compaction*` hook files) and made
self-contained: no `@oh-my-opencode/*` runtime dependencies, no OmO agent/config layer.

## Commands

- `bun install` — install deps
- `bun test` — run the full test suite (must stay green)
- `bun run typecheck` — `tsc --noEmit` (must stay clean)
- `bun run build` — bundle to a single drop-in plugin file at `dist/preemptive-compaction.plugin.js`

Always run `bun test` AND `bun run typecheck` after changing source. Both must pass.

If `bun` is not on PATH, it lives at `~/.bun/bin/bun`.

## Architecture

Entry point: `src/index.ts` exports `PreemptiveCompactionPlugin` (an OpenCode `Plugin`)
plus the lower-level `createPreemptiveCompactionHook`.

Control flow:
- `src/preemptive-compaction.ts` — orchestrator. Returns `{ "tool.execute.after", event }`.
  Maintains per-session token cache, in-progress set, compacted set, cooldown map.
- `src/preemptive-compaction-trigger.ts` — on `tool.execute.after`, computes
  `usage = (input + cache.read) / contextLimit`; if `>= threshold`, calls
  `client.session.summarize`. Cooldown + in-progress guarded. Toast on failure.
- `src/preemptive-compaction-degradation-monitor.ts` — after `session.compacted`, watches
  the next N assistant turns; if `noTextThreshold` consecutive turns are step-only with no
  text, re-runs compaction (recovery). Epoch-guarded so recovery compactions don't re-arm.
- `src/preemptive-compaction-no-text-tail.ts` — detects step-only/no-text assistant parts.
- `src/internal/context-limit-resolver.ts` — resolves a model's true context limit
  (Anthropic GA-1M detection, env flags, model-limits cache). Inlined verbatim from
  `@oh-my-opencode/model-core`.
- `src/internal/local-model-limits.ts` — for providers configured with a custom
  OpenAI-compatible `options.baseURL` (local inference servers), resolves the context limit
  live from the endpoint's `GET /models` (`context_length`, falling back to
  `max_context_length`) with a TTL cache, in-flight dedupe, request timeout, and optional
  Bearer key. The endpoint value is authoritative; the static catalog is the fallback.
- `src/internal/logger.ts` — routes `[preemptive-compaction]` logs through
  `client.app.log`, falling back to `console.debug`. `_setLoggerForTesting` for tests.
- `src/config.ts` — env-driven config with defaults matching OmO.

## Conventions

- Keep the ported logic faithful to the OmO source (do not "simplify" the threshold math,
  cooldown, or epoch/recovery semantics without a test proving the new behavior).
- New behavior must come with a test in `test/`.
- No comments in source unless explaining a non-obvious port decision.
- Threshold default is `0.78`. Env overrides are clamped to `0.5`–`0.95`.
