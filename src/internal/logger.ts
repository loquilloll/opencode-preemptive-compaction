type LogMetadata = Record<string, unknown>

export type LogFn = (message: string, metadata?: LogMetadata) => void

type LoggerSink = {
  log: LogFn
}

const consoleLogger: LoggerSink = {
  log: (message, metadata) => {
    if (metadata && Object.keys(metadata).length > 0) {
      console.debug(message, metadata)
    } else {
      console.debug(message)
    }
  },
}

let activeLogger: LoggerSink = consoleLogger
let testOverrides: LoggerSink | null = null

export const log: LogFn = (message, metadata) => {
  activeLogger.log(message, metadata)
}

export function attachLoggerClient(client: {
  app?: { log?: (input: { body: { service: string; level: string; message: string; extra?: LogMetadata } }) => Promise<unknown> }
}): void {
  const appLog = client.app?.log
  if (typeof appLog !== "function") return

  activeLogger = {
    log: (message, metadata) => {
      void appLog
        .call(client.app, {
          body: {
            service: "preemptive-compaction",
            level: "debug",
            message,
            extra: metadata,
          },
        })
        .catch(() => {
          console.debug(message, metadata)
        })
    },
  }
}

export function _setLoggerForTesting(overrides: { log: LogFn }): void {
  testOverrides = { log: overrides.log }
  activeLogger = testOverrides
}

export function _resetLoggerForTesting(): void {
  testOverrides = null
  activeLogger = consoleLogger
}
