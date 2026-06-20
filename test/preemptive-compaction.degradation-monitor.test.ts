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

describe("preemptive-compaction post-compaction degradation monitor", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  it("triggers recovery summarize after three consecutive no-text tail messages", async () => {
    const sessionHistory: AssistantHistoryMessage[] = []
    const ctx = createMockCtx(sessionHistory)
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_tail_recovery"

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    const stepOnlyParts = [{ type: "step-start" }, { type: "step-finish" }]

    appendAssistantHistory(sessionHistory, { id: "msg_1", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_1", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_2", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_2", parts: stepOnlyParts }))

    appendAssistantHistory(sessionHistory, { id: "msg_3", parts: stepOnlyParts })
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_3", parts: stepOnlyParts }))

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
    expect(ctx.client.tui.showToast).toHaveBeenCalledTimes(1)
    expect(logMock).toHaveBeenCalledWith(
      "[preemptive-compaction] Detected post-compaction no-text tail pattern",
      {
        sessionID,
        streak: 3,
      },
    )
  })

  it("resets no-text streak when assistant emits text content", async () => {
    const sessionHistory: AssistantHistoryMessage[] = []
    const ctx = createMockCtx(sessionHistory)
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_tail_reset"

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    appendAssistantHistory(sessionHistory, {
      id: "msg_1",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    })
    await hook.event(buildAssistantUpdate({
      sessionID,
      id: "msg_1",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    }))

    appendAssistantHistory(sessionHistory, {
      id: "msg_2",
      parts: [{ type: "text", text: "Recovered response" }],
    })
    await hook.event(buildAssistantUpdate({
      sessionID,
      id: "msg_2",
      parts: [{ type: "text", text: "Recovered response" }],
    }))

    appendAssistantHistory(sessionHistory, {
      id: "msg_3",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    })
    await hook.event(buildAssistantUpdate({
      sessionID,
      id: "msg_3",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    }))

    appendAssistantHistory(sessionHistory, {
      id: "msg_4",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    })
    await hook.event(buildAssistantUpdate({
      sessionID,
      id: "msg_4",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    }))

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("uses message update parts without refetching session messages", async () => {
    const sessionHistory: AssistantHistoryMessage[] = []
    const ctx = createMockCtx(sessionHistory)
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_tail_update_parts"
    const stepOnlyParts = [{ type: "step-start" }, { type: "step-finish" }]

    await hook.event({
      event: {
        type: "session.compacted",
        properties: { sessionID },
      },
    })

    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_1", parts: stepOnlyParts }))
    await hook.event(buildAssistantUpdate({ sessionID, id: "msg_2", parts: stepOnlyParts }))

    expect(ctx.client.session.messages).not.toHaveBeenCalled()
    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })
})
