import { beforeEach, describe, expect, it } from "bun:test"

import {
  logMock,
  createMockCtx,
  defaultTestConfig,
  appendAssistantHistory,
  buildAssistantUpdate,
  type AssistantHistoryMessage,
} from "./helpers"

const { createPreemptiveCompactionHook } = await import("../src/preemptive-compaction")

describe("preemptive-compaction degradation monitor regressions", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  it("does not re-arm monitoring after recovery-triggered compaction", async () => {
    const sessionHistory: AssistantHistoryMessage[] = []
    const ctx = createMockCtx(sessionHistory)
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_recovery_compaction_guard"
    const stepOnlyParts = [{ type: "step-start" }, { type: "step-finish" }]

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    appendAssistantHistory(sessionHistory, { id: "msg_1", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_1", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_2", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_2", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_3", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_3", parts: stepOnlyParts }))

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    appendAssistantHistory(sessionHistory, { id: "msg_4", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_4", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_5", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_5", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_6", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_6", parts: stepOnlyParts }))

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })
})
