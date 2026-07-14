import { createHash } from "node:crypto"

export const FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION = 1 as const
export const FLOWDOC_BACKEND_COMPOSITION_MAX_ID_LENGTH = 512
export const FLOWDOC_BACKEND_COMPOSITION_MAX_CHUNK_PAGES = 10_000
export const FLOWDOC_BACKEND_COMPOSITION_MAX_ATTEMPTS = 10_000
export const FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_BYTES = 1_000_000_000
export const FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_RECORDS = 10_000_000

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

export interface FlowDocBackendCompositionContractIssue {
  code: string
  message: string
  path: string
  severity: "error"
}

export type FlowDocBackendCompositionContractResult<T, K extends string> =
  | ({ status: "ready"; issues: [] } & Record<K, T>)
  | ({ status: "blocked"; issues: FlowDocBackendCompositionContractIssue[] } & Record<K, null>)

export function compositionIssue(
  code: string,
  path: string,
  message: string,
): FlowDocBackendCompositionContractIssue {
  return { code, message, path, severity: "error" }
}

export function cloneCompositionJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function compositionFingerprint(value: object): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

export function isCompositionRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readCompositionRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
  issues: FlowDocBackendCompositionContractIssue[],
): Record<string, unknown> | null {
  if (!isCompositionRecord(value)) {
    issues.push(compositionIssue("composition-record-invalid", path, `${path || "value"} must be an object`))
    return null
  }
  const allowed = new Set(keys)
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) issues.push(compositionIssue(
      "composition-record-property-unknown",
      path.length === 0 ? key : `${path}.${key}`,
      `${path.length === 0 ? key : `${path}.${key}`} is not allowed`,
    ))
  })
  return value
}

export function readCompositionString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: FlowDocBackendCompositionContractIssue[],
): string | null {
  const value = record[key]
  if (typeof value === "string" && value.trim().length > 0 && value.length <= FLOWDOC_BACKEND_COMPOSITION_MAX_ID_LENGTH) {
    return value
  }
  issues.push(compositionIssue("composition-string-invalid", path, `${path} must be a non-empty bounded string`))
  return null
}

export function readCompositionFingerprint(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: FlowDocBackendCompositionContractIssue[],
): string | null {
  const value = record[key]
  if (typeof value === "string" && FINGERPRINT.test(value)) return value
  issues.push(compositionIssue("composition-fingerprint-invalid", path, `${path} must be a compact SHA-256 fingerprint`))
  return null
}

export function readNullableCompositionFingerprint(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: FlowDocBackendCompositionContractIssue[],
): string | null | undefined {
  if (record[key] === null) return null
  return readCompositionFingerprint(record, key, path, issues) ?? undefined
}

export function readCompositionInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  minimum: number,
  maximum: number,
  issues: FlowDocBackendCompositionContractIssue[],
): number | null {
  const value = record[key]
  if (typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum) return value
  issues.push(compositionIssue(
    "composition-integer-invalid",
    path,
    `${path} must be an integer from ${minimum} through ${maximum}`,
  ))
  return null
}

export function readCompositionBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: FlowDocBackendCompositionContractIssue[],
): boolean | null {
  const value = record[key]
  if (typeof value === "boolean") return value
  issues.push(compositionIssue("composition-boolean-invalid", path, `${path} must be a boolean`))
  return null
}

export function readCompositionIsoDate(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: FlowDocBackendCompositionContractIssue[],
): string | null {
  const value = record[key]
  if (typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) return value
  issues.push(compositionIssue("composition-date-invalid", path, `${path} must be an exact ISO date-time`))
  return null
}

export function readCompositionLiteral<T extends string | number>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  expected: T,
  issues: FlowDocBackendCompositionContractIssue[],
): T | null {
  if (record[key] === expected) return expected
  issues.push(compositionIssue("composition-literal-invalid", path, `${path} must equal ${String(expected)}`))
  return null
}

export function readCompositionEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  accepted: readonly T[],
  issues: FlowDocBackendCompositionContractIssue[],
): T | null {
  const value = record[key]
  if (typeof value === "string" && accepted.includes(value as T)) return value as T
  issues.push(compositionIssue("composition-enum-invalid", path, `${path} must be one of ${accepted.join(", ")}`))
  return null
}

export function exactCompositionValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function readyCompositionResult<T, K extends string>(key: K, value: T): FlowDocBackendCompositionContractResult<T, K> {
  return { status: "ready", issues: [], [key]: value } as FlowDocBackendCompositionContractResult<T, K>
}

export function blockedCompositionResult<K extends string>(
  key: K,
  issues: FlowDocBackendCompositionContractIssue[],
): { status: "blocked"; issues: FlowDocBackendCompositionContractIssue[] } & Record<K, null> {
  return { status: "blocked", issues, [key]: null } as {
    status: "blocked"
    issues: FlowDocBackendCompositionContractIssue[]
  } & Record<K, null>
}
