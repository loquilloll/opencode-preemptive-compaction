import { mock, type Mock } from "bun:test"
import { DEFAULT_CONFIG, type PreemptiveCompactionConfig } from "../src/config"

export const logMock: Mock<(message: string, metadata?: Record<string, unknown>) => void> = mock(() => {})

mock.module("../src/internal/logger", () => ({
  log: logMock,
  attachLoggerClient: () => {},
}))

export function defaultTestConfig(): PreemptiveCompactionConfig {
  return {
    enabled: DEFAULT_CONFIG.enabled,
    threshold: DEFAULT_CONFIG.threshold,
    cooldownMs: DEFAULT_CONFIG.cooldownMs,
    timeoutMs: DEFAULT_CONFIG.timeoutMs,
    compactionModel: DEFAULT_CONFIG.compactionModel,
    degradationMonitor: {
      enabled: DEFAULT_CONFIG.degradationMonitor.enabled,
      monitorCount: DEFAULT_CONFIG.degradationMonitor.monitorCount,
      noTextThreshold: DEFAULT_CONFIG.degradationMonitor.noTextThreshold,
      recoverySuppressionMs: DEFAULT_CONFIG.degradationMonitor.recoverySuppressionMs,
      maxRecoveryAttempts: DEFAULT_CONFIG.degradationMonitor.maxRecoveryAttempts,
      timeoutMs: DEFAULT_CONFIG.degradationMonitor.timeoutMs,
    },
  }
}

export function createMockCtx(sessionMessagesData: unknown[] = []) {
  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: sessionMessagesData })),
        summarize: mock(() => Promise.resolve({})),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
    directory: "/tmp/test",
  }
}

export type AssistantHistoryMessage = {
  info: {
    id: string
    role: "assistant"
  }
  parts: Array<{ type: string; text?: string }>
}

export function appendAssistantHistory(
  sessionHistory: AssistantHistoryMessage[],
  input: {
    id: string
    parts: AssistantHistoryMessage["parts"]
  },
): void {
  sessionHistory.push({
    info: {
      id: input.id,
      role: "assistant",
    },
    parts: input.parts,
  })
}

export function buildAssistantUpdate(input: {
  sessionID: string
  id: string
  parts: unknown[]
  providerID?: string
  modelID?: string
}): {
  event: {
    type: string
    properties: {
      info: {
        id: string
        role: string
        sessionID: string
        providerID: string
        modelID: string
        finish: boolean
        tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
        parts: unknown[]
      }
    }
  }
} {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: input.id,
          role: "assistant",
          sessionID: input.sessionID,
          providerID: input.providerID ?? "anthropic",
          modelID: input.modelID ?? "claude-sonnet-4-6",
          finish: true,
          tokens: { input: 1000, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
          parts: input.parts,
        },
      },
    },
  }
}

export function buildTokenMessage(args: {
  sessionID: string
  providerID: string
  modelID: string
  input: number
  cacheRead?: number
  agent?: string
}): {
  event: {
    type: string
    properties: {
      info: {
        role: string
        sessionID: string
        providerID: string
        modelID: string
        finish: boolean
        agent?: string
        tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
      }
    }
  }
} {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          sessionID: args.sessionID,
          providerID: args.providerID,
          modelID: args.modelID,
          finish: true,
          agent: args.agent,
          tokens: {
            input: args.input,
            output: 1000,
            reasoning: 0,
            cache: { read: args.cacheRead ?? 0, write: 0 },
          },
        },
      },
    },
  }
}

export function setupImmediateTimeouts(): () => void {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
    callback(...args)
    const timeoutID = originalSetTimeout(() => undefined, 0)
    originalClearTimeout(timeoutID)
    return timeoutID
  }) as typeof setTimeout

  globalThis.clearTimeout = (() => {}) as typeof clearTimeout

  return () => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
}
