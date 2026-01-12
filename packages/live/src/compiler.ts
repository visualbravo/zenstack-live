import type { SchemaDef, GetModels } from '@zenstackhq/schema'
import { z } from 'zod/v4'

export type QueryCompilerOptions<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  schema: Schema
  modelName: ModelName
}

type PrimitiveFilter<T> = {
  equals?: T | null
  in?: T[]
  notIn?: T[]
  lt?: T
  lte?: T
  gt?: T
  gte?: T
  not?: T | PrimitiveFilter<T>
}

type PrimitiveArrayFilter<T> = {
  equals?: T[]
  has?: T
  hasEvery?: T[]
  hasSome?: T[]
  isEmpty?: boolean
}

type EnumFilter = Pick<PrimitiveFilter<string>, 'equals' | 'in' | 'notIn' | 'not'>

type StringFilter = {
  contains?: string
  startsWith?: string
  endsWith?: string
  mode?: 'default' | 'insensitive'
} & PrimitiveFilter<string>

type IntFilter = PrimitiveFilter<number>

type BooleanFilter = Pick<PrimitiveFilter<boolean>, 'equals' | 'not'>

const operatorNames = new Set(['AND', 'OR', 'NOT'])

export class QueryCompiler<Schema extends SchemaDef, ModelName extends GetModels<Schema>> {
  private readonly options: QueryCompilerOptions<Schema, ModelName>

  constructor(options: QueryCompilerOptions<Schema, ModelName>) {
    this.options = options
  }

  compile(where: any) {
    const schemaFields: Record<string, unknown> = {}
    const model = this.options.schema.models[this.options.modelName]!
    let andSchemas: z.ZodSchema[] | undefined
    let notSchemas: z.ZodSchema[] | undefined
    let orSchemas: z.ZodSchema[] | undefined

    for (const [key, value] of Object.entries(where)) {
      if (operatorNames.has(key)) {
        if (key === 'AND') {
          if (Array.isArray(value)) {
            andSchemas = value.map(where => this.compile(where))
          } else {
            andSchemas = [this.compile(value)]
          }

          continue
        }

        if (key === 'NOT') {
          if (Array.isArray(value)) {
            notSchemas = value.map(where => this.compile(where))
          } else {
            notSchemas = [this.compile(value)]
          }

          continue
        }

        if (key === 'OR' && Array.isArray(value)) {
          orSchemas = value.map(where => this.compile(where))
        }

        continue
      }

      const field = Object.values(model.fields).find(field => field.name === key)!
      const isEnum = !!this.options.schema.enums?.[field.type]

      if (isEnum) {
        continue
      }

      switch (field.type) {
        case 'String':
          if (field.array) {
            schemaFields[key] = QueryCompiler.compileStringArray(
              value as PrimitiveArrayFilter<string>,
            )
          } else {
            schemaFields[key] = QueryCompiler.compileString(
              value as string | PrimitiveFilter<string>,
            )
          }
          break
        case 'Boolean':
          if (field.array) {
            schemaFields[key] = QueryCompiler.compileBooleanArray(
              value as PrimitiveArrayFilter<boolean>,
            )
          } else {
            schemaFields[key] = QueryCompiler.compileBoolean(
              value as boolean | PrimitiveFilter<boolean>,
            )
          }
          break
        case 'Int':
          if (field.array) {
            schemaFields[key] = QueryCompiler.compileIntArray(value as PrimitiveArrayFilter<number>)
          }
          else {
            schemaFields[key] = QueryCompiler.compileInt(value as number | IntFilter)
          }
          break
        case 'BigInt':
          schemaFields[key] = QueryCompiler.compileBigInt(value as bigint | IntFilter)
          break
        case 'DateTime':
          schemaFields[key] = QueryCompiler.compileDateTime(value as Date | PrimitiveFilter<Date>)
          break
        default:
          break
      }
    }

    const localSchema = z.object(schemaFields)

    return z.any().refine(payload => {
      if (!localSchema.safeParse(payload).success) {
        return false
      }

      if (andSchemas) {
        for (const schema of andSchemas) {
          if (!schema.safeParse(payload).success) {
            return false
          }
        }
      }

      if (orSchemas && orSchemas.length > 0) {
        let matched = false

        for (const schema of orSchemas) {
          if (schema.safeParse(payload).success) {
            matched = true
            break
          }
        }

        if (!matched) {
          return false
        }
      }

      if (notSchemas) {
        for (const schema of notSchemas) {
          if (schema.safeParse(payload).success) {
            return false
          }
        }
      }

      return true
    })
  }

  static compileString(value: string | StringFilter) {
    if (typeof value === 'string') {
      return z.literal(value)
    }

    if (typeof value.equals !== 'undefined') {
      return z.literal(value.equals)
    }

    let schema = z.string()

    if (typeof value.startsWith !== 'undefined') {
      if (value.mode === 'insensitive') {
        schema = schema.startsWith(value.startsWith.toLowerCase()).toLowerCase()
      } else {
        schema = schema.startsWith(value.startsWith)
      }
    }

    if (typeof value.endsWith !== 'undefined') {
      if (value.mode === 'insensitive') {
        schema = schema.endsWith(value.endsWith.toLowerCase()).toLowerCase()
      } else {
        schema = schema.endsWith(value.endsWith)
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
      schema = schema.refine(v => !this.compileString(value.not!).safeParse(v).success)
    }

    return schema
  }

  static compileStringArray(value: PrimitiveArrayFilter<string>) {
    if (value.isEmpty === true) {
      return z.string().array().length(0)
    }

    let schema = z.string().array()

    if (typeof value.equals !== 'undefined') {
      schema = schema.refine(v => {
        for (let i = 0; i < value.equals!.length; i++) {
          if (v[i] !== value.equals![i]) {
            return false
          }
        }

        return true
      })
    }

    if (typeof value.hasEvery !== 'undefined') {
      schema = schema.refine(v => {
        const vSet = new Set(v)
        const valueSet = new Set(value.hasEvery!)

        return vSet.isSupersetOf(valueSet)
      })
    }

    if (typeof value.hasSome !== 'undefined') {
      schema = schema.refine(v => {
        const vSet = new Set(v)
        const valueSet = new Set(value.hasSome!)

        return vSet.intersection(valueSet).size > 0
      })
    }

    if (typeof value.has !== 'undefined') {
      schema = schema.refine(v => {
        return v.includes(value.has!)
      })
    }

    return schema
  }

  static compileBoolean(value: boolean | BooleanFilter) {
    if (typeof value === 'boolean') {
      return z.literal(value)
    }

    if (typeof value.equals !== 'undefined') {
      return z.literal(value.equals)
    }

    let schema = z.boolean()

    if (typeof value.not !== 'undefined') {
      schema = schema.refine(v => !this.compileBoolean(value.not!).safeParse(v).success)
    }

    return schema
  }

  static compileBooleanArray(value: PrimitiveArrayFilter<boolean>) {
    if (value.isEmpty === true) {
      return z.boolean().array().length(0)
    }

    let schema = z.boolean().array()

    if (typeof value.equals !== 'undefined') {
      schema = schema.refine(v => {
        for (let i = 0; i < value.equals!.length; i++) {
          if (v[i] !== value.equals![i]) {
            return false
          }
        }

        return true
      })
    }

    if (typeof value.hasEvery !== 'undefined') {
      schema = schema.refine(v => {
        const vSet = new Set(v)
        const valueSet = new Set(value.hasEvery!)

        return vSet.isSupersetOf(valueSet)
      })
    }

    if (typeof value.hasSome !== 'undefined') {
      schema = schema.refine(v => {
        const vSet = new Set(v)
        const valueSet = new Set(value.hasSome!)

        return vSet.intersection(valueSet).size > 0
      })
    }

    if (typeof value.has !== 'undefined') {
      schema = schema.refine(v => {
        return v.includes(value.has!)
      })
    }

    return schema
  }

  static compileEnum(value: string | EnumFilter) {
    if (typeof value === 'string') {
      return z.literal(value)
    }

    if (typeof value.equals !== 'undefined') {
      return z.literal(value.equals)
    }

    let schema = z.string()

    if (typeof value.in !== 'undefined') {
      schema = schema.refine(v => value.in?.includes(v))
    }

    if (typeof value.notIn !== 'undefined') {
      schema = schema.refine(v => !value.notIn?.includes(v))
    }

    if (typeof value.not !== 'undefined') {
      schema = schema.refine(v => !this.compileEnum(value.not!).safeParse(v).success)
    }

    return schema
  }

  static compileInt(value: number | IntFilter) {
    if (typeof value === 'number') {
      return z.literal(value)
    }

    if (typeof value.equals !== 'undefined') {
      return z.literal(value.equals)
    }

    let schema = z.number()

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
      schema = schema.refine(v => !this.compileInt(value.not!).safeParse(v).success)
    }

    return schema
  }

  static compileIntArray(value: PrimitiveArrayFilter<number>) {
    if (value.isEmpty === true) {
      return z.number().array().length(0)
    }

    let schema = z.number().array()

    if (typeof value.equals !== 'undefined') {
      schema = schema.refine(v => {
        for (let i = 0; i < value.equals!.length; i++) {
          if (v[i] !== value.equals![i]) {
            return false
          }
        }

        return true
      })
    }

    if (typeof value.hasEvery !== 'undefined') {
      schema = schema.refine(v => {
        const vSet = new Set(v)
        const valueSet = new Set(value.hasEvery!)

        return vSet.isSupersetOf(valueSet)
      })
    }

    if (typeof value.hasSome !== 'undefined') {
      schema = schema.refine(v => {
        const vSet = new Set(v)
        const valueSet = new Set(value.hasSome!)

        return vSet.intersection(valueSet).size > 0
      })
    }

    if (typeof value.has !== 'undefined') {
      schema = schema.refine(v => {
        return v.includes(value.has!)
      })
    }

    return schema
  }

  private static isBigInt(value: unknown): value is bigint {
    return value instanceof BigInt
  }

  static compileBigInt(value: bigint | IntFilter) {
    if (this.isBigInt(value)) {
      return z.literal(value)
    }

    if (typeof value.equals !== 'undefined') {
      return z.literal(value.equals)
    }

    let schema = z.bigint()

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

    if (typeof value.not !== 'undefined') {
      schema = schema.refine(v => !this.compileInt(value.not!).safeParse(v).success)
    }

    return schema
  }

  static compileDateTime(value: Date | PrimitiveFilter<Date>) {
    if (value instanceof Date) {
      return z.date().refine(v => v.getTime() === value.getTime())
    }

    if (value.equals instanceof Date) {
      return z.date().refine(v => v.getTime() === value.equals!.getTime())
    }

    let schema = z.date()

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
      schema = schema.refine(v => value.in?.some(v2 => v2.getTime() === v.getTime()))
    }

    if (typeof value.notIn !== 'undefined') {
      schema = schema.refine(v => value.notIn?.some(v2 => v2.getTime() !== v.getTime()))
    }

    if (typeof value.not !== 'undefined') {
      schema = schema.refine(v => !this.compileDateTime(value.not!).safeParse(v).success)
    }

    return schema
  }
}
