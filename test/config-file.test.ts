import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { logMock } from "./helpers"

const { readConfigFile, resolveConfigFilePath, stripJsoncComments } = await import("../src/internal/config-file")

describe("stripJsoncComments", () => {
  it("removes line and block comments", () => {
    expect(stripJsoncComments('{"a":1}//c')).toBe('{"a":1}')
    expect(stripJsoncComments('/*x*/{"a":1}')).toBe('{"a":1}')
    expect(stripJsoncComments('{"a":1/*x*/}')).toBe('{"a":1}')
  })

  it("removes multi-line block comments", () => {
    const input = `{
  /* this is a
     multi-line
     block comment */
  "a": 1
}`
    expect(stripJsoncComments(input)).toBe(`{
  
  "a": 1
}`)
  })

  it("preserves // and /* inside string literals, including with a trailing real comment", () => {
    const input = '{"url":"http://example.com"}//real comment'
    expect(stripJsoncComments(input)).toBe('{"url":"http://example.com"}')
  })

  it("preserves escaped quotes inside string literals", () => {
    const input = '{"msg":"he said \\"hi\\" // not a comment"}'
    expect(stripJsoncComments(input)).toBe(input)
  })

  it("handles empty and whitespace-only input", () => {
    expect(stripJsoncComments("")).toBe("")
    expect(stripJsoncComments("   ")).toBe("   ")
    expect(stripJsoncComments("// only a comment\n")).toBe("\n")
  })
})

describe("resolveConfigFilePath", () => {
  let dir: string
  const pluginFile = "preemptive-compaction.js"

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pc-cfg-"))
    writeFileSync(join(dir, pluginFile), "// plugin")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const url = () => pathToFileURL(join(dir, pluginFile)).href

  it("finds preemptive-compaction.config.json next to the plugin", () => {
    const cfg = join(dir, "preemptive-compaction.config.json")
    writeFileSync(cfg, "{}")
    expect(resolveConfigFilePath(url())).toBe(cfg)
  })

  it("falls back to .jsonc when .json is absent", () => {
    const cfg = join(dir, "preemptive-compaction.config.jsonc")
    writeFileSync(cfg, "{}")
    expect(resolveConfigFilePath(url())).toBe(cfg)
  })

  it("prefers .json when both .json and .jsonc exist", () => {
    const json = join(dir, "preemptive-compaction.config.json")
    const jsonc = join(dir, "preemptive-compaction.config.jsonc")
    writeFileSync(json, "{}")
    writeFileSync(jsonc, "{}")
    expect(resolveConfigFilePath(url())).toBe(json)
  })

  it("returns undefined when neither file exists", () => {
    expect(resolveConfigFilePath(url())).toBeUndefined()
  })
})

describe("readConfigFile", () => {
  let dir: string
  const pluginFile = "preemptive-compaction.js"

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pc-cfg-"))
    writeFileSync(join(dir, pluginFile), "// plugin")
    logMock.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const url = () => pathToFileURL(join(dir, pluginFile)).href

  it("returns parsed object for a valid .json", () => {
    writeFileSync(join(dir, "preemptive-compaction.config.json"), JSON.stringify({ threshold: 0.9 }))
    const file = readConfigFile({ baseUrl: url() })
    expect(file?.threshold).toBe(0.9)
    expect(logMock).not.toHaveBeenCalled()
  })

  it("strips JSONC comments from .jsonc and parses", () => {
    writeFileSync(
      join(dir, "preemptive-compaction.config.jsonc"),
      `{
        // compaction threshold
        "threshold": 0.9,
        /* model limits */
        "modelLimits": { "ozore/auto": 100000 }
      }`,
    )
    const file = readConfigFile({ baseUrl: url() })
    expect(file?.threshold).toBe(0.9)
    expect(file?.modelLimits?.["ozore/auto"]).toBe(100_000)
  })

  it("returns undefined silently when the file is missing (no warning)", () => {
    expect(readConfigFile({ baseUrl: url() })).toBeUndefined()
    expect(logMock).not.toHaveBeenCalled()
  })

  it("returns undefined and logs once on malformed JSON", () => {
    writeFileSync(join(dir, "preemptive-compaction.config.json"), "{ not json")
    expect(readConfigFile({ baseUrl: url() })).toBeUndefined()
    expect(logMock).toHaveBeenCalledTimes(1)
  })

  it("returns undefined and logs when root is an array", () => {
    writeFileSync(join(dir, "preemptive-compaction.config.json"), "[1,2,3]")
    expect(readConfigFile({ baseUrl: url() })).toBeUndefined()
    expect(logMock).toHaveBeenCalledTimes(1)
    expect(logMock.mock.calls[0]![0]).toContain("config file root is not an object")
  })

  it("returns undefined and logs when root is a primitive", () => {
    writeFileSync(join(dir, "preemptive-compaction.config.json"), "42")
    expect(readConfigFile({ baseUrl: url() })).toBeUndefined()
    expect(logMock).toHaveBeenCalledTimes(1)
  })

  it("default baseUrl (import.meta.url) resolves next to source without crashing", () => {
    expect(readConfigFile()).toBeUndefined()
  })
})
