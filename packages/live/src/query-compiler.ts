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

// The hydrated value, and the JSON that Postgres would see.
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
function jsonbRank(value: unknown) {
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

function compareValues(left: any, right: any): number {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return Buffer.compare(left, right)
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime()
  }

  const rank = jsonbRank(left) - jsonbRank(right)

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

// `trim(jsonb::text, '"')`, which is how ZenStack reads strings and enums inside of JSON.
function jsonText(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value).replace(/^"+|"+$/g, '')
}

function jsonKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    return value.map(item => jsonKey(item, key)).find(item => item !== undefined)
  }

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
function selectJsonPath(value: unknown, steps: JsonPathStep[]) {
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

// The `@>` operator.
function jsonbContains(container: unknown, contained: unknown): boolean {
  if (Array.isArray(container) && Array.isArray(contained)) {
    return contained.every(item => container.some(other => jsonbContains(other, item)))
  }

  if (isPlainObject(container) && isPlainObject(contained)) {
    return Object.entries(contained).every(
      ([key, item]) => key in container && jsonbContains(container[key], item),
    )
  }

  return isDeepStrictEqual(container, contained)
}

function jsonValueClause(expected: unknown): Predicate {
  if (expected === null || expected instanceof DbNullClass) {
    return isNull
  }

  if (expected instanceof JsonNullClass) {
    return value => value === null
  }

  if (expected instanceof AnyNullClass) {
    return value => value === undefined || value === null
  }

  return value => (value === undefined ? null : isDeepStrictEqual(value, expected))
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

export class QueryCompiler<Schema extends SchemaDef, ModelName extends GetModels<Schema>> {
  private readonly options: QueryCompilerOptions<Schema, ModelName>
  private readonly validator: InputValidator<Schema>

  public constructor(options: QueryCompilerOptions<Schema, ModelName>) {
    this.options = options
    this.validator = new InputValidator(options.client, {
      enabled: options.client.$options.validateInput !== false,
    })
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
        predicate({ value: jsonKey(hydrated, key), raw: jsonKey(raw, key) }),
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
      return ({ value }) => predicate(jsonText(value))
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
            predicates.push(jsonValueClause(value))
          }

          break
        case 'not':
          if (value !== undefined) {
            const clause = jsonValueClause(value)
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
          const like = compileLike(operation, value as string, insensitive)

          predicates.push(json =>
            json === undefined
              ? null
              : typeof json === 'string' && like(JSON.stringify(json).slice(1, -1)),
          )

          break
        }
        case 'array_contains': {
          const contained = Array.isArray(value) ? value : [value]

          predicates.push(json => (json === undefined ? null : jsonbContains(json, contained)))
          break
        }
        case 'array_starts_with':
          predicates.push(
            jsonArrayElementClause(value, json =>
              Array.isArray(json) ? json[0] : jsonKey(json, '0'),
            ),
          )

          break
        case 'array_ends_with':
          predicates.push(
            jsonArrayElementClause(value, json => (Array.isArray(json) ? json.at(-1) : undefined)),
          )

          break
      }
    }

    const predicate = all(predicates)

    return ({ raw }) => predicate(raw === undefined ? undefined : selectJsonPath(raw, steps))
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
          const like = compileLike(operation, search, insensitive)

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
        value === undefined ? null : test(compareValues(prepare(value), right))

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
                : items.some(item => valuesEqual(prepare(value), item))

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
