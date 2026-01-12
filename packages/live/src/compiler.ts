// oxlint-disable no-continue
// oxlint-disable max-statements
// oxlint-disable default-case
// oxlint-disable no-non-null-assertion
// oxlint-disable no-empty
// oxlint-disable no-lone-blocks
// oxlint-disable no-extraneous-class
// oxlint-disable no-explicit-any
// oxlint-disable init-declarations
// oxlint-disable no-unused-vars

import type { SchemaDef, GetModels } from '@zenstackhq/schema'
import type { WhereInput, ClientContract, SimplifiedPlainResult } from '@zenstackhq/orm'
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite'
import { parse } from 'lossless-json'
import type { LiveStreamOptions, ZenStackLiveEvent } from '.'
import { z } from 'zod/v4'

export type QueryCompilerOptions<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  schema: Schema
  modelName: ModelName
}

type PrimitiveFilter<T> = {
  equals?: T
  in?: T[]
  notIn?: T[]
  lt?: T
  lte?: T
  gt?: T
  gte?: T
  not?: T | PrimitiveFilter<T>
}

type StringFilter = {
  contains?: string
  startsWith?: string
  endsWith?: string
  mode?: 'default' | 'insensitive'
} & PrimitiveFilter<string>

type IntFilter = {
  contains?: string
  startsWith?: string
  endsWith?: string
  mode?: 'default' | 'insensitive'
} & PrimitiveFilter<number>

const operatorNames = new Set(['AND', 'OR', 'NOT'])

export class QueryCompiler<Schema extends SchemaDef, ModelName extends GetModels<Schema>> {
  private readonly options: QueryCompilerOptions<Schema, ModelName>

  constructor(options: QueryCompilerOptions<Schema, ModelName>) {
    this.options = options
  }

  compile(where: any) {
    const schemaFields: Record<string, unknown> = {}
    const model = this.options.schema.models[this.options.modelName]!

    for (const [key, value] of Object.entries(where)) {
      const field = Object.values(model.fields).find(field => field.name === key)!

      switch (field.type) {
        case 'String':
          schemaFields[key] = QueryCompiler.compileString(value as string | PrimitiveFilter<string>)
          break
        case 'Int':
          schemaFields[key] = QueryCompiler.compileInt(value as number | PrimitiveFilter<number>)
          break
        case 'DateTime':
          schemaFields[key] = QueryCompiler.compileDateTime(value as Date | PrimitiveFilter<Date>)
          break
      }
    }

    return z.object(schemaFields)
  }

  static compileString(value: string | StringFilter) {
    if (typeof value === 'string') {
      return z.literal(value)
    }

    let schema = z.string()

    if (typeof value.equals !== 'undefined') {
      return z.literal(value.equals)
    }

    if (typeof value.startsWith !== 'undefined') {
      if (value.mode === 'insensitive') {
        schema = schema.startsWith(value.startsWith.toLowerCase()).toLowerCase()
      } else {
        schema = schema.startsWith(value.startsWith)
      }
    }

    if (typeof value.endsWith !== 'undefined') {
      if (value.mode === 'insensitive') {
        schema = schema.startsWith(value.endsWith.toLowerCase()).toLowerCase()
      } else {
        schema = schema.startsWith(value.endsWith)
      }
    }

    if (typeof value.contains !== 'undefined') {
      if (value.mode === 'insensitive') {
        schema = schema.includes(value.contains.toLowerCase()).toLowerCase()
      } else {
        schema = schema.includes(value.contains)
      }
    }

    if (typeof value.gt !== 'undefined') {
      schema = schema.refine(v => v > value.gt!)
    }

    if (typeof value.gte !== 'undefined') {
      schema = schema.refine(v => v >= value.gte!)
    }

    if (typeof value.lt !== 'undefined') {
      schema = schema.refine(v => v < value.lt!)
    }

    if (typeof value.lte !== 'undefined') {
      schema = schema.refine(v => v <= value.lte!)
    }

    if (typeof value.in !== 'undefined') {
      schema = schema.refine(v => value.in?.includes(v))
    }

    if (typeof value.notIn !== 'undefined') {
      schema = schema.refine(v => !value.notIn?.includes(v))
    }

    if (typeof value.not !== 'undefined') {
      const { success } = this.compileString(value.not).safeParse(value.not)

      schema = schema.refine(() => !success)
    }

    return schema
  }

  static compileInt(value: number | IntFilter) {
    if (typeof value === 'number') {
      return z.literal(value)
    }

    let schema = z.number()

    if (typeof value.equals !== 'undefined') {
      return z.literal(value.equals)
    }

    if (typeof value.gt !== 'undefined') {
      schema = schema.refine(v => v > value.gt!)
    }

    if (typeof value.gte !== 'undefined') {
      schema = schema.refine(v => v >= value.gte!)
    }

    if (typeof value.lt !== 'undefined') {
      schema = schema.refine(v => v < value.lt!)
    }

    if (typeof value.lte !== 'undefined') {
      schema = schema.refine(v => v <= value.lte!)
    }

    if (typeof value.in !== 'undefined') {
      schema = schema.refine(v => value.in?.includes(v))
    }

    if (typeof value.notIn !== 'undefined') {
      schema = schema.refine(v => !value.notIn?.includes(v))
    }

    if (typeof value.not !== 'undefined') {
      const { success } = this.compileInt(value.not).safeParse(value.not)

      schema = schema.refine(() => !success)
    }

    return schema
  }

  static compileDateTime(value: Date | PrimitiveFilter<Date>) {
    if (value instanceof Date) {
      return z.date().refine(v => v === value)
    }

    let schema = z.date()

    if (typeof value.equals !== 'undefined') {
      schema.refine(v => v === value)
    }

    if (typeof value.gt !== 'undefined') {
      schema = schema.refine(v => v > value.gt!)
    }

    if (typeof value.gte !== 'undefined') {
      schema = schema.refine(v => v >= value.gte!)
    }

    if (typeof value.lt !== 'undefined') {
      schema = schema.refine(v => v < value.lt!)
    }

    if (typeof value.lte !== 'undefined') {
      schema = schema.refine(v => v <= value.lte!)
    }

    if (typeof value.in !== 'undefined') {
      schema = schema.refine(v => value.in?.includes(v))
    }

    if (typeof value.notIn !== 'undefined') {
      schema = schema.refine(v => !value.notIn?.includes(v))
    }

    if (typeof value.not !== 'undefined') {
      const { success } = this.compileDateTime(value.not).safeParse(value.not)

      schema = schema.refine(() => !success)
    }

    return schema
  }
}
