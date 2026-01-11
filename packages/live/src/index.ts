/* eslint-disable */

import type { SchemaDef, GetModels } from '@zenstackhq/schema'
import type { WhereInput, ClientContract, SimplifiedPlainResult } from '@zenstackhq/orm'
import { ZenStackClient, InputValidator } from '@zenstackhq/orm'
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite'
import { parse } from 'lossless-json'
// @ts-expect-error
import SQLite from 'better-sqlite3'
import { object, string, z } from 'zod'
import { Redis } from 'ioredis'
import Decimal from 'decimal.js'
import type {
  XReadGroupResponse,
  XAutoClaimResult,
  StreamMessage,
  StreamEntry,
  ParsedStreamEntry,
  DebeziumChangeEvent,
  DebeziumShortEventType,
  DebeziumSource,
} from './internal'

const operationMap: Record<DebeziumShortEventType, DatabaseEventType> = {
  c: 'created',
  u: 'updated',
  d: 'deleted',
}

export type DatabaseEventType = 'created' | 'updated' | 'deleted'

export type LiveSubscriptionOptions<
  Schema extends SchemaDef,
  ModelName extends GetModels<Schema>,
> = {
  model: ModelName
  id: string
  created?: WhereInput<Schema, ModelName, true>
  updated?: {
    before?: WhereInput<Schema, ModelName, true>
    after?: WhereInput<Schema, ModelName, true>
  }
  deleted?: WhereInput<Schema, ModelName, true>
}

export class LiveSubscription<Schema extends SchemaDef, ModelName extends GetModels<Schema>> {
  private readonly options: LiveSubscriptionOptions<Schema, ModelName>
  private readonly modelName: ModelName
  private readonly streamName: string
  private readonly consumerName: string
  private readonly consumerGroupName: string

  constructor(options: LiveSubscriptionOptions<Schema, ModelName>) {
    this.options = options
    this.modelName = options.model
    this.streamName = `zenstack.table.public.${this.modelName}`
    this.consumerName = 'zenstack'
    this.consumerGroupName = `zenstack.table.public.${this.modelName}.${this.options.id}`
  }
}

export type RecordCreatedEvent<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  type: 'created'
  id: string
  date: Date
  created: SimplifiedPlainResult<Schema, ModelName>
}

export type ZenStackLiveEvent<T extends Record<string, unknown> = {}> = {
  id: string
  date: Date
  before: T | null
  after: T | null
  type: DatabaseEventType
}

export type RecordUpdatedEvent<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  type: 'updated'
  id: string
  date: Date
  before: SimplifiedPlainResult<Schema, ModelName>
  after: SimplifiedPlainResult<Schema, ModelName>
}

export type RecordDeletedEvent<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  type: 'deleted'
  id: string
  date: Date
  deleted: SimplifiedPlainResult<Schema, ModelName>
}

export type RecordEvent<Schema extends SchemaDef, ModelName extends GetModels<Schema>> =
  | RecordCreatedEvent<Schema, ModelName>
  | RecordUpdatedEvent<Schema, ModelName>
  | RecordDeletedEvent<Schema, ModelName>

export type RecordResultMap<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  created: RecordCreatedEvent<Schema, ModelName>
  updated: RecordUpdatedEvent<Schema, ModelName>
  deleted: RecordDeletedEvent<Schema, ModelName>
}

export type ZenStackLiveOptions<Schema extends SchemaDef> = {
  schema: Schema
  redis: {
    url: string
  }
}

export class ZenStackLive<Schema extends SchemaDef> {
  private readonly options: ZenStackLiveOptions<Schema>
  private readonly redis: Redis

  constructor(options: ZenStackLiveOptions<Schema>) {
    this.options = options
    this.redis = new Redis(options.redis.url)
  }

  async *stream<ModelName extends GetModels<Schema>>(
    subscription: LiveSubscriptionOptions<Schema, ModelName>,
  ): AsyncIterable<RecordEvent<Schema, ModelName>> {
    const modelName = subscription.model
    const streamName = this.getStreamName(modelName)
    const consumerName = 'zenstack'
    const consumerGroupName = `zenstack.table.public.${modelName}.${subscription.id}`

    await this.makeConsumerGroup(streamName, consumerGroupName)

    while (this.redis.status === 'ready') {
      const events = await this.getLatestEvents(
        modelName,
        streamName,
        consumerGroupName,
        consumerName,
      )

      if (events.length === 0) {
        await this.sleep(2000)
      }

      for (const event of events) {
        if (event.type === 'created') {
          yield {
            type: 'created',
            id: event.id,
            date: event.date,
            // @ts-expect-error
            created: event.after,
          }
        } else if (event.type === 'updated') {
          yield {
            type: 'updated',
            id: event.id,
            date: event.date,
            // @ts-expect-error
            before: event.before,
            // @ts-expect-error

            after: event.after,
          }
        } else if (event.type === 'deleted') {
          yield {
            type: 'deleted',
            id: event.id,
            date: event.date,
            // @ts-expect-error
            deleted: event.before,
          }
        }

        await this.acknowledgeEvent(streamName, consumerGroupName, event.id)
      }
    }
  }

  private async makeConsumerGroup(streamName: string, consumerGroupName: string) {
    try {
      await this.redis.xgroup('CREATE', streamName, consumerGroupName, '$', 'MKSTREAM')
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('BUSYGROUP Consumer Group name already exists')
      ) {
        return
      }

      throw error
    }
  }

  private async sleep(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  private getStreamName(modelName: string) {
    return `zenstack.table.public.${modelName}`
  }

  private hydratePayload(modelName: string, payload: any) {
    for (const [fieldName, fieldDef] of Object.entries(
      this.options.schema.models[modelName]!.fields,
    )) {
      switch (fieldDef.type) {
        case 'BigInt':
          payload[fieldName] = BigInt(payload[fieldName])
          break
        case 'Int':
          payload[fieldName] = Number(payload[fieldName])
          break
        case 'Decimal':
          payload[fieldName] = Decimal(payload[fieldName])
          break
        case 'DateTime':
          payload[fieldName] = new Date(Number(payload[fieldName]) / 1000)
          break
        case 'Boolean':
          payload[fieldName] = payload[fieldName] === 'true'
          break
        case 'Float':
          payload[fieldName] = parseFloat(payload[fieldName])
          break
        default:
          throw new Error(`Field "${fieldName}" has an unsupported type ("${fieldDef.type}")`)
      }
    }
  }

  public async acknowledgeEvent(streamName: string, consumerGroupName: string, eventId: string) {
    await this.redis
      .multi()
      .xack(streamName, consumerGroupName, eventId)
      .xdel(streamName, eventId)
      .exec()
  }

  private async getLatestEvents(
    modelName: string,
    streamName: string,
    consumerGroupName: string,
    consumerName: string,
  ) {
    const events: ZenStackLiveEvent[] = []
    const xReadGroupResponse = (await this.redis.xreadgroup(
      'GROUP',
      consumerGroupName,
      consumerName,
      'COUNT',
      5,
      'BLOCK',
      0,
      'STREAMS',
      streamName,
      '>',
    )) as XReadGroupResponse | null

    if (xReadGroupResponse) {
      for (const [, entries] of xReadGroupResponse) {
        for (const [eventId, fields] of entries) {
          const [, eventJson] = fields

          if (eventJson === 'default') {
            continue
          }

          let event = this.parseJson<any>(modelName, eventJson)

          if (!event) {
            continue
          }

          const operation = operationMap[event.op as DebeziumShortEventType]

          if (operation === 'created') {
            this.hydratePayload(modelName, event.after)
          } else if (operation === 'updated') {
            this.hydratePayload(modelName, event.before)
            this.hydratePayload(modelName, event.after)
          } else {
            this.hydratePayload(modelName, event.before)
          }

          events.push({
            id: eventId,
            date: new Date(Number(event.ts_ms)),
            before: event.before,
            after: event.after,
            type: operation,
          })
        }
      }
    }

    return events
  }

  private parseJson<T>(modelName: string, json: string) {
    return parse(json, undefined, {
      parseNumber: value => {
        return value
      },
    }) as T
  }

  disconnect() {
    this.redis.disconnect()
  }
}
