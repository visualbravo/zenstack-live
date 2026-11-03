import type { AttributeApplication } from '@zenstackhq/schema'

export type DebeziumSource = {
  version: string
  connector: string
  name: string
  ts_ms: number
  snapshot: string | boolean
  db: string
  sequence?: string
  ts_us?: number
  ts_ns?: number
  schema: string
  table: string
  txId?: number
  lsn?: number
  xmin?: number | null
}

export type DebeziumChangeEvent<T extends Record<string, unknown> = {}> = {
  before: T | null
  after: T | null
  source: DebeziumSource
  transaction: unknown | null
  op: DebeziumShortEventType
  ts_ms: number
  ts_us?: number
  ts_ns?: number
}

export type DebeziumShortEventType = 'c' | 'u' | 'd'

export type ParsedStreamEntry<T extends Record<string, unknown> = {}> = {
  key: {
    id: number
  }

  value: DebeziumChangeEvent<T>
}

export type XReadGroupResponse = [stream: string, entries: StreamEntry[]][]

export type StreamEntry = [id: string, keyValuePairs: [string, string]]

export type XAutoClaimResult = [nextStartId: string, messages: StreamMessage[]]

export type StreamMessage = [id: string, fields: [key: string, value: string][]]

export type StrictOmit<T, K> = { [P in keyof T as Exclude<P, K>]: T[P] }

// What's kept about each stream in Redis, because consumer groups don't hold any of this.
export type RecordedStream = {
  slug: string
  model: string
  redisStream: string
  retention: number
  preparedAt: number
}

// What Postgres holds for the columns that hydration changes, because filters run against that. It
// keeps JSON nulls apart from NULLs, and NULL arrays apart from the empty arrays they hydrate to.
export const sourceValues = Symbol('sourceValues')

export function getAttribute(
  definition: { attributes?: readonly AttributeApplication[] },
  attribute: string,
  arg: string,
) {
  const value = definition.attributes
    ?.find(({ name }) => name === attribute)
    ?.args?.find(({ name }) => name === arg)?.value

  return value?.kind === 'literal' ? String(value.value) : undefined
}
