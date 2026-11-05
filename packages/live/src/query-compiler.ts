// oxlint-disable default-case react/function-component-definition max-params no-nested-ternary
import type { SchemaDef, GetModels, FieldDef, TypeDefDef } from '@zenstackhq/schema'
import {
  AnyNullClass,
  DbNullClass,
  InputValidator,
  JsonNullClass,
  type ClientContract,
} from '@zenstackhq/orm'
import Decimal from 'decimal.js'
import { isDeepStrictEqual } from 'node:util'
import { sourceValues } from './internal'

export type QueryCompilerOptions<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  client: ClientContract<Schema>
  modelName: ModelName
}

// SQL's three-valued logic, where `null` means unknown. Only `true` selects a row.
type Verdict = boolean | null

// `undefined` is SQL's NULL. Inside of JSON, `null` is a JSON null.
type Predicate = (value: unknown) => Verdict

// The hydrated value, and the JSON that the database would see.
type JsonReceiver = { value: unknown; raw: unknown }
type JsonPredicate = (receiver: JsonReceiver) => Verdict

type JsonPathStep =
  | { type: 'key'; key: string }
  | { type: 'index'; index: number | 'last' }
  | { type: 'wildcard' }
  | { type: 'elements' }

const logicalOperators = new Set(['AND', 'OR', 'NOT'])
const jsonFilterNames = [
  'path',
  'equals',
  'not',
  'string_contains',
  'string_starts_with',
  'string_ends_with',
  'array_contains',
  'array_starts_with',
  'array_ends_with',
]

const and = (verdicts: Verdict[]): Verdict =>
  verdicts.includes(false) ? false : verdicts.includes(null) ? null : true

const or = (verdicts: Verdict[]): Verdict =>
  verdicts.includes(true) ? true : verdicts.includes(null) ? null : false

const not = (verdict: Verdict): Verdict => (verdict === null ? null : !verdict)

const all =
  <T>(predicates: ((value: T) => Verdict)[]) =>
  (value: T) =>
    and(predicates.map(predicate => predicate(value)))

const isNull: Predicate = value => value === undefined

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

function isNumeric(value: unknown) {
  return typeof value === 'number' || typeof value === 'bigint' || Decimal.isDecimal(value)
}

// Values only differ in type inside of JSON, where this is how Postgres orders `jsonb`.
function postgresJsonRank(value: unknown) {
  if (value === null) {
    return 0
  }

  if (typeof value === 'string' || value instanceof Date) {
    return 1
  }

  if (isNumeric(value)) {
    return 2
  }

  if (typeof value === 'boolean') {
    return 3
  }

  return Array.isArray(value) ? 4 : 5
}

// How MySQL orders JSON values of different types, from lowest to highest.
function mysqlJsonRank(value: unknown) {
  if (value === null) {
    return 0
  }

  if (isNumeric(value)) {
    return 1
  }

  if (typeof value === 'string' || value instanceof Date) {
    return 2
  }

  if (typeof value === 'boolean') {
    return 5
  }

  return Array.isArray(value) ? 4 : 3
}

function compareValues(
  left: any,
  right: any,
  jsonRank: (value: unknown) => number = postgresJsonRank,
): number {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return Buffer.compare(left, right)
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime()
  }

  const rank = jsonRank(left) - jsonRank(right)

  if (rank !== 0) {
    return rank
  }

  if (Decimal.isDecimal(left) || Decimal.isDecimal(right)) {
    return new Decimal(left.toString()).cmp(right.toString())
  }

  if (isNumeric(left) || typeof left === 'string' || typeof left === 'boolean') {
    return left < right ? -1 : left > right ? 1 : 0
  }

  return isDeepStrictEqual(left, right) ? 0 : 1
}

const valuesEqual = (left: unknown, right: unknown) => compareValues(left, right) === 0

// MySQL's default collation, `utf8mb4_0900_ai_ci`, ignores case and accents. Columns are assumed to
// use it, and text cast from JSON always does.
const mysqlCollator = new Intl.Collator('und', { sensitivity: 'base' })

function castFilterValue(type: string, value: any) {
  switch (type) {
    case 'BigInt':
      return BigInt(value)
    case 'Decimal':
      return new Decimal(value)
    case 'DateTime':
      return new Date(value)
    default:
      return value
  }
}

function compileLike(operation: string, search: string, insensitive: boolean) {
  const needle = insensitive ? search.toLowerCase() : search

  return (text: string) => {
    const haystack = insensitive ? text.toLowerCase() : text

    switch (operation) {
      case 'startsWith':
        return haystack.startsWith(needle)
      case 'endsWith':
        return haystack.endsWith(needle)
      default:
        return haystack.includes(needle)
    }
  }
}

// MySQL's `LIKE` compares one character at a time under the collation, so unlike `=`, it doesn't
// match "ß" to "ss".
function compileMysqlLike(operation: string, search: string) {
  const needle = Array.from(search)

  return (text: string) => {
    const haystack = Array.from(text)
    const matchesAt = (start: number) =>
      needle.every((char, index) => mysqlCollator.compare(haystack[start + index]!, char) === 0)
    const last = haystack.length - needle.length

    if (last < 0) {
      return false
    }

    switch (operation) {
      case 'startsWith':
        return matchesAt(0)
      case 'endsWith':
        return matchesAt(last)
      default:
        return Array.from({ length: last + 1 }, (_, start) => start).some(matchesAt)
    }
  }
}

// MySQL stores an object's keys shortest first, and then by their bytes.
function mysqlKeys(value: Record<string, unknown>) {
  return Object.keys(value).toSorted((left, right) => {
    const a = Buffer.from(left)
    const b = Buffer.from(right)

    return a.length - b.length || Buffer.compare(a, b)
  })
}

// `CAST(json AS CHAR)` on MySQL, which puts spaces after separators.
function mysqlJsonString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(mysqlJsonString).join(', ')}]`
  }

  if (isPlainObject(value)) {
    return `{${mysqlKeys(value)
      .map(key => `${JSON.stringify(key)}: ${mysqlJsonString(value[key])}`)
      .join(', ')}}`
  }

  return JSON.stringify(value)
}

// `trim(json::text, '"')`, which is how ZenStack reads strings and enums inside of JSON.
function trimJsonText(value: unknown, stringify: (value: unknown) => string) {
  return value === undefined ? undefined : stringify(value).replace(/^"+|"+$/g, '')
}

// Postgres's lax mode looks through arrays when finding keys.
function laxJsonKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    return value.map(item => laxJsonKey(item, key)).find(item => item !== undefined)
  }

  return isPlainObject(value) ? value[key] : undefined
}

function strictJsonKey(value: unknown, key: string): unknown {
  return isPlainObject(value) ? value[key] : undefined
}

function parseJsonPath(path: string) {
  const steps: JsonPathStep[] = []
  let rest = path.trim()

  if (!rest.startsWith('$')) {
    throw new Error(`JSON path "${path}" is not supported`)
  }

  rest = rest.slice(1)

  while (rest.length > 0) {
    let match: RegExpExecArray | null

    if ((match = /^\.\*/.exec(rest))) {
      steps.push({ type: 'wildcard' })
    } else if ((match = /^\.([A-Za-z_$][\w$]*)/.exec(rest))) {
      steps.push({ type: 'key', key: match[1]! })
    } else if ((match = /^\.("(?:[^"\\]|\\.)*")/.exec(rest))) {
      steps.push({ type: 'key', key: JSON.parse(match[1]!) })
    } else if ((match = /^\[\*\]/.exec(rest))) {
      steps.push({ type: 'elements' })
    } else if ((match = /^\[(\d+|last)\]/.exec(rest))) {
      steps.push({ type: 'index', index: match[1] === 'last' ? 'last' : Number(match[1]) })
    } else {
      throw new Error(`JSON path "${path}" is not supported`)
    }

    rest = rest.slice(match[0].length)
  }

  return steps
}

// Follows the lax mode of `jsonb_path_query_first`, which looks through arrays when finding keys,
// and treats anything else as an array of one when indexing.
function selectLaxJsonPath(value: unknown, steps: JsonPathStep[]) {
  let values = [value]

  for (const step of steps) {
    values = values.flatMap(item => {
      const items = Array.isArray(item) ? item : [item]

      switch (step.type) {
        case 'key':
          return items.flatMap(entry =>
            isPlainObject(entry) && step.key in entry ? [entry[step.key]] : [],
          )
        case 'wildcard':
          return items.flatMap(entry => (isPlainObject(entry) ? Object.values(entry) : []))
        case 'elements':
          return items
        case 'index': {
          const index = step.index === 'last' ? items.length - 1 : step.index

          return index >= 0 && index < items.length ? [items[index]] : []
        }
      }
    })
  }

  return values[0]
}

// MySQL's `JSON_EXTRACT`, which only finds keys in objects, and treats anything else as an array of
// one when indexing. A path with a wildcard selects an array of every match.
function selectMysqlJsonPath(value: unknown, steps: JsonPathStep[]) {
  let values = [value]

  for (const step of steps) {
    values = values.flatMap(item => {
      switch (step.type) {
        case 'key':
          return isPlainObject(item) && step.key in item ? [item[step.key]] : []
        case 'wildcard':
          return isPlainObject(item) ? mysqlKeys(item).map(key => item[key]) : []
        case 'elements':
          return Array.isArray(item) ? item : []
        case 'index': {
          const items = Array.isArray(item) ? item : [item]
          const index = step.index === 'last' ? items.length - 1 : step.index

          return index >= 0 && index < items.length ? [items[index]] : []
        }
      }
    })
  }

  if (values.length === 0) {
    return undefined
  }

  return steps.some(({ type }) => type === 'wildcard' || type === 'elements') ? values : values[0]
}

// The `@>` operator.
function postgresJsonContains(container: unknown, contained: unknown): boolean {
  if (Array.isArray(container) && Array.isArray(contained)) {
    return contained.every(item => container.some(other => postgresJsonContains(other, item)))
  }

  if (isPlainObject(container) && isPlainObject(contained)) {
    return Object.entries(contained).every(
      ([key, item]) => key in container && postgresJsonContains(container[key], item),
    )
  }

  return isDeepStrictEqual(container, contained)
}

// `JSON_CONTAINS`, which unlike `@>` also finds a value inside of any array.
function mysqlJsonContains(container: unknown, contained: unknown): boolean {
  if (Array.isArray(container)) {
    return Array.isArray(contained)
      ? contained.every(item => mysqlJsonContains(container, item))
      : container.some(item => mysqlJsonContains(item, contained))
  }

  if (isPlainObject(container) && isPlainObject(contained)) {
    return Object.entries(contained).every(
      ([key, item]) => key in container && mysqlJsonContains(container[key], item),
    )
  }

  return !Array.isArray(contained) && isDeepStrictEqual(container, contained)
}

// JSON nulls and SQL's NULL, which every database compares the same way.
function jsonNullClause(expected: unknown): Predicate | undefined {
  if (expected instanceof DbNullClass) {
    return isNull
  }

  if (expected instanceof JsonNullClass) {
    return value => value === null
  }

  if (expected instanceof AnyNullClass) {
    return value => value === undefined || value === null
  }

  return undefined
}

function jsonValueClause(expected: unknown): Predicate {
  return (
    jsonNullClause(expected) ??
    (value => (value === undefined ? null : isDeepStrictEqual(value, expected)))
  )
}

// Array filters store their value as `jsonb`, so a null means a JSON null, and not a missing value.
function jsonArrayElementClause(expected: unknown, select: (value: unknown) => unknown): Predicate {
  const clause =
    expected === null ? jsonValueClause(new JsonNullClass()) : jsonValueClause(expected)

  return value => {
    const element = select(value)

    return element === undefined ? null : clause(element)
  }
}

// Where the databases that ZenStack compiles a filter for disagree on what it means.
type DialectRules = {
  // Strings in a column, and text cast from JSON.
  compareText: (left: string, right: string) => number
  compileLike: (
    operation: string,
    search: string,
    insensitive: boolean,
  ) => (text: string) => boolean
  jsonRank: (value: unknown) => number
  jsonString: (value: unknown) => string
  jsonKey: (value: unknown, key: string) => unknown
  selectJsonPath: (value: unknown, steps: JsonPathStep[]) => unknown

  // A plain JSON filter's `equals`, which isn't one of the JSON nulls.
  jsonEquals: (expected: unknown) => Predicate
  jsonContains: (container: unknown, contained: unknown) => boolean
  firstElement: (json: unknown) => unknown
  lastElement: (json: unknown) => unknown
}

const postgresRules: DialectRules = {
  compareText: (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  compileLike,
  jsonRank: postgresJsonRank,
  jsonString: value => JSON.stringify(value),
  jsonKey: laxJsonKey,
  selectJsonPath: selectLaxJsonPath,

  // ZenStack compares a JSON null with `IS NULL` here.
  jsonEquals: expected => (expected === null ? isNull : jsonValueClause(expected)),
  jsonContains: postgresJsonContains,
  firstElement: json => (Array.isArray(json) ? json[0] : laxJsonKey(json, '0')),
  lastElement: json => (Array.isArray(json) ? json.at(-1) : undefined),
}

const mysqlRules: DialectRules = {
  compareText: (left, right) => mysqlCollator.compare(left, right),

  // ZenStack doesn't take `mode` on MySQL, where the collation already ignores case.
  compileLike: (operation, search) => compileMysqlLike(operation, search),
  jsonRank: mysqlJsonRank,
  jsonString: mysqlJsonString,
  jsonKey: strictJsonKey,
  selectJsonPath: selectMysqlJsonPath,

  // ZenStack compares with `JSON_CONTAINS` both ways, where a JSON null is a value like any other.
  jsonEquals: expected => value =>
    value === undefined
      ? null
      : mysqlJsonContains(value, expected) && mysqlJsonContains(expected, value),
  jsonContains: mysqlJsonContains,
  firstElement: json => (Array.isArray(json) ? json[0] : json),

  // `JSON_LENGTH` counts an object's keys, and is 1 for anything else that isn't an array.
  lastElement: json =>
    Array.isArray(json)
      ? json.at(-1)
      : isPlainObject(json)
        ? Object.keys(json).length === 1
          ? json
          : undefined
        : json,
}

export class QueryCompiler<Schema extends SchemaDef, ModelName extends GetModels<Schema>> {
  private readonly options: QueryCompilerOptions<Schema, ModelName>
  private readonly validator: InputValidator<Schema>
  private readonly rules: DialectRules

  public constructor(options: QueryCompilerOptions<Schema, ModelName>) {
    this.options = options
    this.validator = new InputValidator(options.client, {
      enabled: options.client.$options.validateInput !== false,
    })
    this.rules = options.client.$schema.provider.type === 'mysql' ? mysqlRules : postgresRules
  }

  private compare(left: unknown, right: unknown) {
    if (typeof left === 'string' && typeof right === 'string') {
      return this.rules.compareText(left, right)
    }

    return compareValues(left, right, this.rules.jsonRank)
  }

  private get schema() {
    return this.options.client.$schema
  }

  // ZenStack decides what's valid, and coerces it, so that a filter means the same thing here.
  public compile(where: any) {
    const validated = this.validator.validateExistsArgs(this.options.modelName as any, { where })
    const predicate = this.compileWhere((validated as { where: object }).where)

    return (payload: unknown) =>
      typeof payload === 'object' && payload !== null && predicate(payload) === true
  }

  private compileWhere(where: object): Predicate {
    const model = this.schema.models[this.options.modelName]!
    const predicates: Predicate[] = []

    for (const [key, payload] of Object.entries(where)) {
      if (payload === undefined) {
        continue
      }

      if (key === '$expr') {
        throw new Error('Filter "$expr" is not supported, because it has to run in the database')
      }

      if (logicalOperators.has(key)) {
        predicates.push(this.compileLogical(key, payload))
        continue
      }

      const field = model.fields[key]!

      if (field.relation || field.computed) {
        throw new Error(`Field "${key}" can't be filtered on, because events don't contain it`)
      }

      predicates.push(this.compileField(key, field, payload))
    }

    return all(predicates)
  }

  private compileLogical(key: string, payload: unknown): Predicate {
    const predicates = (Array.isArray(payload) ? payload : [payload])
      .filter(where => Object.values(where).some(value => value !== undefined))
      .map(where => this.compileWhere(where))

    switch (key) {
      case 'OR':
        return row => or(predicates.map(predicate => predicate(row)))
      case 'NOT':
        return predicates.length === 0 ? () => true : row => not(all(predicates)(row))
      default:
        return all(predicates)
    }
  }

  private effectiveType(type: string) {
    return this.schema.typeDefs?.[type]?.base ?? type
  }

  private isTypedJson(type: string) {
    const typeDef = this.schema.typeDefs?.[type]

    return Boolean(typeDef && !typeDef.base)
  }

  private compileField(name: string, field: FieldDef, payload: unknown): Predicate {
    const read = (row: any) => {
      const sources = row[sourceValues]

      return sources && name in sources && sources[name] === undefined
        ? undefined
        : (row[name] ?? undefined)
    }

    if (field.array) {
      const predicate = this.compileArray(field, payload)

      return row => predicate(read(row))
    }

    if (this.isTypedJson(field.type) || this.effectiveType(field.type) === 'Json') {
      const predicate = this.compileJsonField(field, payload)

      return row => predicate(this.readJson(row, name))
    }

    const predicate = this.compilePrimitive(field.type, payload)

    return row => predicate(read(row))
  }

  private readJson(row: any, name: string): JsonReceiver {
    const sources = row[sourceValues]

    if (sources && name in sources) {
      return { value: row[name], raw: sources[name] }
    }

    const value = row[name] ?? undefined

    return { value, raw: value }
  }

  private compileJsonField(field: FieldDef, payload: unknown): JsonPredicate {
    if (payload === null) {
      return ({ raw }) => isNull(raw)
    }

    if (
      payload instanceof DbNullClass ||
      payload instanceof JsonNullClass ||
      payload instanceof AnyNullClass
    ) {
      const clause = jsonValueClause(payload)

      return ({ raw }) => clause(raw)
    }

    if (this.isTypedJson(field.type)) {
      return this.compileTypedJson(this.schema.typeDefs![field.type]!, payload)
    }

    return this.compilePlainJson(payload as Record<string, unknown>)
  }

  private compileTypedJson(typeDef: TypeDefDef, filter: any): JsonPredicate {
    if (filter === null) {
      return ({ value }) => (value === undefined ? null : value === null)
    }

    if (jsonFilterNames.some(name => name in filter)) {
      return this.compilePlainJson(filter)
    }

    if ('is' in filter || 'isNot' in filter) {
      const predicates: JsonPredicate[] = []

      if (typeof filter.is === 'object' && filter.is !== null) {
        predicates.push(this.compileTypedJson(typeDef, filter.is))
      }

      if (typeof filter.isNot === 'object' && filter.isNot !== null) {
        const predicate = this.compileTypedJson(typeDef, filter.isNot)
        predicates.push(receiver => not(predicate(receiver)))
      }

      return all(predicates)
    }

    const predicates: JsonPredicate[] = []

    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) {
        continue
      }

      const predicate = this.compileTypedJsonField(typeDef.fields[key]!, value)

      predicates.push(({ value: hydrated, raw }) =>
        predicate({
          value: this.rules.jsonKey(hydrated, key),
          raw: this.rules.jsonKey(raw, key),
        }),
      )
    }

    return all(predicates)
  }

  private compileTypedJsonField(field: FieldDef, filter: unknown): JsonPredicate {
    if (this.isTypedJson(field.type)) {
      const typeDef = this.schema.typeDefs![field.type]!

      return field.array
        ? this.compileTypedJsonArray(typeDef, filter)
        : this.compileTypedJson(typeDef, filter)
    }

    if (field.array) {
      const predicate = this.compileArray(field, filter)

      return ({ value }) => predicate(value)
    }

    const type = this.effectiveType(field.type)
    const predicate = this.compilePrimitive(field.type, filter)

    if (type === 'String' || this.schema.enums?.[type]) {
      return ({ value }) => predicate(trimJsonText(value, this.rules.jsonString))
    }

    return ({ value }) => predicate(value)
  }

  private compileTypedJsonArray(typeDef: TypeDefDef, filter: any): JsonPredicate {
    const predicates: JsonPredicate[] = []

    const elements = ({ value, raw }: JsonReceiver): JsonReceiver[] =>
      Array.isArray(value)
        ? value.map((item, index) => ({ value: item, raw: (raw as unknown[])[index] }))
        : []

    for (const [key, value] of Object.entries(filter)) {
      if (typeof value !== 'object' || value === null) {
        continue
      }

      const predicate = this.compileTypedJson(typeDef, value)
      const some = (receiver: JsonReceiver) =>
        elements(receiver).some(element => predicate(element) === true)

      switch (key) {
        case 'some':
          predicates.push(some)
          break
        case 'none':
          predicates.push(receiver => !some(receiver))
          break
        case 'every':
          predicates.push(
            receiver => !elements(receiver).some(element => predicate(element) === false),
          )
          break
      }
    }

    return all(predicates)
  }

  private compilePlainJson(filter: Record<string, unknown>): JsonPredicate {
    if (!jsonFilterNames.some(name => name in filter)) {
      throw new Error('Invalid JSON filter payload')
    }

    const steps = typeof filter['path'] === 'string' ? parseJsonPath(filter['path']) : []
    const insensitive = filter['mode'] === 'insensitive'
    const predicates: Predicate[] = []

    for (const [key, value] of Object.entries(filter)) {
      switch (key) {
        case 'equals':
          if (value !== undefined) {
            predicates.push(jsonNullClause(value) ?? this.rules.jsonEquals(value))
          }

          break
        case 'not':
          if (value !== undefined) {
            const clause = jsonNullClause(value) ?? this.rules.jsonEquals(value)
            predicates.push(json => not(clause(json)))
          }

          break
        case 'string_contains':
        case 'string_starts_with':
        case 'string_ends_with': {
          const operation = {
            string_contains: 'contains',
            string_starts_with: 'startsWith',
            string_ends_with: 'endsWith',
          }[key]
          const like = this.rules.compileLike(operation, value as string, insensitive)

          predicates.push(json =>
            json === undefined
              ? null
              : typeof json === 'string' && like(JSON.stringify(json).slice(1, -1)),
          )

          break
        }
        case 'array_contains': {
          const contained = Array.isArray(value) ? value : [value]

          predicates.push(json =>
            json === undefined ? null : this.rules.jsonContains(json, contained),
          )
          break
        }
        case 'array_starts_with':
          predicates.push(jsonArrayElementClause(value, this.rules.firstElement))
          break
        case 'array_ends_with':
          predicates.push(jsonArrayElementClause(value, this.rules.lastElement))

          break
      }
    }

    const predicate = all(predicates)

    return ({ raw }) =>
      predicate(raw === undefined ? undefined : this.rules.selectJsonPath(raw, steps))
  }

  private compileArray(field: FieldDef, filter: any): Predicate {
    const type = this.effectiveType(field.type)
    const cast = (value: unknown) => castFilterValue(type, value)
    const includes = (items: unknown[], item: unknown) =>
      items.some(other => other !== null && valuesEqual(other, item))

    const predicates: ((items: unknown[]) => boolean)[] = []

    if (filter.equals !== undefined) {
      const expected = (filter.equals as unknown[]).map(cast)

      predicates.push(
        items =>
          items.length === expected.length &&
          items.every((item, index) => valuesEqual(item, expected[index])),
      )
    }

    if (filter.has !== undefined) {
      const expected = cast(filter.has)
      predicates.push(items => includes(items, expected))
    }

    if (filter.hasEvery !== undefined) {
      const expected = (filter.hasEvery as unknown[]).map(cast)
      predicates.push(items => expected.every(item => includes(items, item)))
    }

    if (filter.hasSome !== undefined) {
      const expected = (filter.hasSome as unknown[]).map(cast)
      predicates.push(items => expected.some(item => includes(items, item)))
    }

    if (filter.isEmpty !== undefined) {
      predicates.push(items => (items.length === 0) === filter.isEmpty)
    }

    return value => {
      if (predicates.length === 0) {
        return true
      }

      return Array.isArray(value) ? predicates.every(predicate => predicate(value)) : null
    }
  }

  private compilePrimitive(fieldType: string, payload: unknown): Predicate {
    const type = this.effectiveType(fieldType)

    if (type === 'String') {
      return this.compileString(payload)
    }

    return this.compileStandard(
      payload,
      value => castFilterValue(type, value),
      value => this.compilePrimitive(fieldType, value),
    )
  }

  private compileString(payload: unknown): Predicate {
    const mode = isPlainObject(payload) ? payload['mode'] : undefined
    const insensitive = mode === 'insensitive'
    const fold = (value: unknown) =>
      insensitive && typeof value === 'string' ? value.toLowerCase() : value

    const predicates = [
      this.compileStandard(payload, fold, value => this.compileString(value), fold),
    ]

    if (isPlainObject(payload)) {
      for (const operation of ['contains', 'startsWith', 'endsWith']) {
        const search = payload[operation]

        if (typeof search === 'string') {
          const like = this.rules.compileLike(operation, search, insensitive)

          predicates.push(value => (value === undefined ? null : like(value as string)))
        }
      }
    }

    return all(predicates)
  }

  // `recurse` compiles the value of `not`, which ignores the `mode` of the filter it's inside of.
  private compileStandard(
    payload: unknown,
    cast: (value: unknown) => unknown,
    recurse: (value: unknown) => Predicate,
    prepare: (value: unknown) => unknown = value => value,
  ): Predicate {
    if (payload === null) {
      return isNull
    }

    const comparison =
      (test: (order: number) => boolean, right: unknown): Predicate =>
      value =>
        value === undefined ? null : test(this.compare(prepare(value), right))

    if (!isPlainObject(payload)) {
      return comparison(order => order === 0, cast(payload))
    }

    const predicates: Predicate[] = []

    for (const [operator, operand] of Object.entries(payload) as [string, any][]) {
      if (operand === undefined) {
        continue
      }

      switch (operator) {
        case 'equals':
          predicates.push(
            operand === null ? isNull : comparison(order => order === 0, cast(operand)),
          )

          break
        case 'in':
        case 'notIn': {
          const items = (operand as unknown[]).map(cast)
          const matches: Predicate = value =>
            items.length === 0
              ? false
              : value === undefined
                ? null
                : items.some(item => this.compare(prepare(value), item) === 0)

          predicates.push(
            operator === 'in'
              ? matches
              : value => (items.length === 0 ? true : not(matches(value))),
          )

          break
        }
        case 'lt':
          predicates.push(comparison(order => order < 0, cast(operand)))
          break
        case 'lte':
          predicates.push(comparison(order => order <= 0, cast(operand)))
          break
        case 'gt':
          predicates.push(comparison(order => order > 0, cast(operand)))
          break
        case 'gte':
          predicates.push(comparison(order => order >= 0, cast(operand)))
          break
        case 'between':
          predicates.push(
            comparison(order => order >= 0, cast(operand[0])),
            comparison(order => order <= 0, cast(operand[1])),
          )

          break
        case 'not': {
          const predicate = recurse(operand)
          predicates.push(value => not(predicate(value)))
          break
        }
        case 'fuzzy':
        case 'fts':
          throw new Error(
            `Filter "${operator}" is not supported, because it has to run in the database`,
          )
      }
    }

    return all(predicates)
  }
}
