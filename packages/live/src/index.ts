/* eslint-disable */

import type { SchemaDef, GetModels } from '@zenstackhq/schema'
import type { WhereInput, ClientContract, SimplifiedPlainResult } from '@zenstackhq/orm'
import { ZenStackClient, InputValidator } from '@zenstackhq/orm'
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite'
import { parse } from 'lossless-json'
// @ts-expect-error
import SQLite from 'better-sqlite3'
import { Redis } from 'ioredis'
import Decimal from 'decimal.js'
import hash from 'stable-hash'
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
import { EventDiscriminator } from './discriminator'

const operationMap: Record<DebeziumShortEventType, DatabaseEventType> = {
  c: 'created',
  u: 'updated',
  d: 'deleted',
}

export type DatabaseEventType = 'created' | 'updated' | 'deleted'

export type LiveStreamOptions<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  model: ModelName
  redis: Redis
  schema: Schema
  id: string
  clientId: string
  created?: WhereInput<Schema, ModelName, true>
  updated?: {
    before?: WhereInput<Schema, ModelName, true>
    after?: WhereInput<Schema, ModelName, true>
  }
  deleted?: WhereInput<Schema, ModelName, true>
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

  /**
   * This client's unique ID. Used for horizontal scaling.
   */
  id: string

  redis: {
    url: string
  }
}

export class LiveStream<Schema extends SchemaDef, ModelName extends GetModels<Schema>> {
  private readonly options: LiveStreamOptions<Schema, ModelName>
  private readonly modelName: ModelName
  private readonly streamName: string
  private readonly consumerName: string
  private readonly consumerGroupName: string
  private readonly discriminator: EventDiscriminator<Schema, ModelName>

  constructor(options: LiveStreamOptions<Schema, ModelName>) {
    const hashed = hash({
      id: options.id,
      created: options.created,
      updated: options.updated,
      deleted: options.deleted,
    })

    this.options = options
    this.modelName = options.model
    this.streamName = `zenstack.table.public.${this.modelName}`
    this.consumerName = `zenstack.${options.clientId}`
    this.consumerGroupName = `zenstack.table.public.${this.modelName}.${hashed}`
    this.discriminator = new EventDiscriminator(options)
  }

  private async makeConsumerGroup() {
    try {
      await this.options.redis.xgroup(
        'CREATE',
        this.streamName,
        this.consumerGroupName,
        '$',
        'MKSTREAM',
      )
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

  private async acknowledgeEvent(eventId: string) {
    await this.options.redis
      .multi()
      .xack(this.streamName, this.consumerGroupName, eventId)
      .xdel(this.streamName, eventId)
      .exec()
  }

  private parseJson<T>(json: string) {
    return parse(json, undefined, {
      parseNumber: value => {
        return value
      },
    }) as T
  }

  private async sleep(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  async *[Symbol.asyncIterator]() {
    await this.makeConsumerGroup()

    while (this.options.redis.status === 'ready') {
      const events = await this.getLatestEvents()

      if (events.length === 0) {
        await this.sleep(1000)
      }

      for (const event of events) {
        if (!this.discriminator.eventMatchesWhere(event)) {
          continue
        }

        if (event.type === 'created') {
          yield {
            type: 'created',
            id: event.id,
            date: event.date,
            created: event.after,
          }
        } else if (event.type === 'updated') {
          yield {
            type: 'updated',
            id: event.id,
            date: event.date,
            before: event.before,
            after: event.after,
          }
        } else if (event.type === 'deleted') {
          yield {
            type: 'deleted',
            id: event.id,
            date: event.date,
            deleted: event.before,
          }
        }

        await this.acknowledgeEvent(event.id)
      }
    }
  }

  private hydratePayload(payload: any) {
    for (const [fieldName, field] of Object.entries(
      this.options.schema.models[this.modelName]!.fields,
    )) {
      if (field.relation) {
        continue
      }

      if ([null, undefined, NaN].includes(payload[fieldName])) {
        payload[fieldName] = null
      }

      switch (field.type) {
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
        case 'Bytes':
          throw new Error(`Field "${fieldName}" has an unsupported type ("${field.type}")`)
      }
    }
  }

  private async getLatestEvents() {
    const events: ZenStackLiveEvent[] = []
    const xReadGroupResponse = (await this.options.redis.xreadgroup(
      'GROUP',
      this.consumerGroupName,
      this.consumerName,
      'COUNT',
      5,
      'BLOCK',
      0,
      'STREAMS',
      this.streamName,
      '>',
    )) as XReadGroupResponse | null

    if (xReadGroupResponse) {
      for (const [, entries] of xReadGroupResponse) {
        for (const [eventId, fields] of entries) {
          const [, eventJson] = fields

          if (eventJson === 'default') {
            continue
          }

          let event = this.parseJson<any>(eventJson)

          if (!event) {
            continue
          }

          const operation = operationMap[event.op as DebeziumShortEventType]

          if (operation === 'created') {
            this.hydratePayload(event.after)
          } else if (operation === 'updated') {
            this.hydratePayload(event.before)
            this.hydratePayload(event.after)
          } else {
            this.hydratePayload(event.before)
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
}

export class ZenStackLive<Schema extends SchemaDef> {
  private readonly options: ZenStackLiveOptions<Schema>
  private readonly redis: Redis

  constructor(options: ZenStackLiveOptions<Schema>) {
    this.options = options
    this.redis = new Redis(options.redis.url)
  }

  stream<ModelName extends GetModels<Schema>>(
    streamOptions: Omit<LiveStreamOptions<Schema, ModelName>, 'schema' | 'redis' | 'clientId'>,
  ) {
    return new LiveStream({
      ...streamOptions,
      redis: this.redis,
      clientId: this.options.id,
      schema: this.options.schema,
    })
  }

  disconnect() {
    this.redis.disconnect()
  }
}
