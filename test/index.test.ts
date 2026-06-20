import { describe, expect, it, beforeEach, afterEach } from "bun:test"

import { createMockCtx } from "./helpers"

const { PreemptiveCompactionPlugin } = await import("../src/index")

const ENABLED_KEY = "PREEMPTIVE_COMPACTION_ENABLED"
const originalEnabled = process.env[ENABLED_KEY]

describe("PreemptiveCompactionPlugin entry", () => {
  beforeEach(() => {
    delete process.env[ENABLED_KEY]
  })

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env[ENABLED_KEY]
    } else {
      process.env[ENABLED_KEY] = originalEnabled
    }
  })

  it("returns no hooks when disabled via PREEMPTIVE_COMPACTION_ENABLED=false", async () => {
    process.env[ENABLED_KEY] = "false"
    const ctx = createMockCtx()
    const hooks = await PreemptiveCompactionPlugin({ client: ctx.client, directory: ctx.directory })
    expect(hooks).toEqual({})
  })

  it("returns the tool.execute.after and event hooks when enabled", async () => {
    const ctx = createMockCtx()
    const hooks = await PreemptiveCompactionPlugin({ client: ctx.client, directory: ctx.directory })
    expect(typeof hooks).toBe("object")
    expect(hooks).not.toEqual({})
    expect(typeof (hooks as Record<string, unknown>)["tool.execute.after"]).toBe("function")
    expect(typeof (hooks as Record<string, unknown>)["event"]).toBe("function")
  })
})
