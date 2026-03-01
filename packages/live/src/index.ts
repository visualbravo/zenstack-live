/* eslint-disable */

import type { SchemaDef, GetModels } from '@zenstackhq/schema'
import type { WhereInput, SimplifiedPlainResult, ClientContract } from '@zenstackhq/orm'
import { parse } from 'lossless-json'
import { Redis } from 'ioredis'
import Decimal from 'decimal.js'
import hash from 'stable-hash'
import Bottleneck from 'bottleneck'
import { Buffer } from 'node:buffer'
import type {
  XReadGroupResponse,
  XAutoClaimResult,
  StreamEntry,
  DebeziumShortEventType,
  StrictOmit,
  DebeziumDecimal,
} from './internal'
import { EventDiscriminator } from './event-discriminator'

const operationMap: Record<DebeziumShortEventType, DatabaseEventType> = {
  c: 'created',
  u: 'updated',
  d: 'deleted',
}

export type DatabaseEventType = 'created' | 'updated' | 'deleted'
export type LiveStreamConsumeOption = 'new' | 'errored' | 'all'

export type LiveStreamRateLimitOption = StrictOmit<
  Bottleneck.ConstructorOptions,
  | 'id'
  | 'Redis'
  | 'Promise'
  | 'clientOptions'
  | 'clearDatastore'
  | 'rejectOnDrop'
  | 'clusterNodes'
  | 'connection'
  | 'datastore'
  | 'trackDoneStatus'
>

export type LiveStreamOptions<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  model: ModelName
  redis: Redis
  client: ClientContract<Schema>
  id: string
  clientId: string
  consume?: LiveStreamConsumeOption
  rateLimit?: LiveStreamRateLimitOption
  created?: WhereInput<Schema, ModelName, {}, true>
  updated?: {
    before?: WhereInput<Schema, ModelName, {}, true>
    after?: WhereInput<Schema, ModelName, {}, true>
  }
  deleted?: WhereInput<Schema, ModelName, {}, true>
}

export type RecordCreatedEvent<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  type: 'created'
  id: string
  transactionId: string
  date: Date
  created: SimplifiedPlainResult<Schema, ModelName>
}

export type RecordUpdatedEvent<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  type: 'updated'
  id: string
  transactionId: string
  date: Date
  updated: {
    before: SimplifiedPlainResult<Schema, ModelName>
    after: SimplifiedPlainResult<Schema, ModelName>
  }
}

export type RecordDeletedEvent<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  type: 'deleted'
  id: string
  transactionId: string
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

export type ExtractRequestedEvents<
  Schema extends SchemaDef,
  ModelName extends GetModels<Schema>,
  Opts,
> =
  | (Opts extends { created: any } ? RecordCreatedEvent<Schema, ModelName> : never)
  | (Opts extends { updated: any } ? RecordUpdatedEvent<Schema, ModelName> : never)
  | (Opts extends { deleted: any } ? RecordDeletedEvent<Schema, ModelName> : never)

export type RequestedEvents<Schema extends SchemaDef, ModelName extends GetModels<Schema>, Opts> = [
  ExtractRequestedEvents<Schema, ModelName, Opts>,
] extends [never]
  ? RecordEvent<Schema, ModelName>
  : ExtractRequestedEvents<Schema, ModelName, Opts>

export type PickStreamFilters<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  created?: WhereInput<Schema, ModelName, {}, true>
  updated?: {
    before?: WhereInput<Schema, ModelName, {}, true>
    after?: WhereInput<Schema, ModelName, {}, true>
  }
  deleted?: WhereInput<Schema, ModelName, {}, true>
}

export type ZenStackLiveOptions<Schema extends SchemaDef> = {
  client: ClientContract<Schema>

  /**
   * This client's unique ID. Used for horizontal scaling.
   */
  id?: string

  redis: {
    url: string
  }
}

export class LiveStream<
  Schema extends SchemaDef,
  ModelName extends GetModels<Schema>,
  Opts = unknown,
> implements AsyncIterable<RequestedEvents<Schema, ModelName, Opts>> {
  private static readonly MIN_IDLE_TIME = 30_000

  private readonly options: LiveStreamOptions<Schema, ModelName>
  private readonly modelName: ModelName
  private readonly streamName: string
  private readonly consumerName: string
  private readonly consumerGroupName: string
  private readonly discriminator: EventDiscriminator<Schema, ModelName>
  private readonly limiter: Bottleneck

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
    this.limiter = new Bottleneck({
      ...options.rateLimit,
      id: this.consumerGroupName,
      Redis: this.options.redis,
    })
  }

  private async alterTable() {
    await this.options.client.$queryRawUnsafe(
      `ALTER TABLE "${this.modelName}" REPLICA IDENTITY FULL`,
    )
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

  async *[Symbol.asyncIterator](): AsyncIterator<RequestedEvents<Schema, ModelName, Opts>> {
    await Promise.all([this.makeConsumerGroup(), this.alterTable()])

    const consume = this.options.consume ?? 'new'

    while (this.options.redis.status === 'ready') {
      let events: RecordEvent<Schema, ModelName>[]

      switch (consume) {
        case 'new':
          events = await this.getNewEvents()
          break
        case 'errored':
          events = await this.getErroredEvents()
          break
        case 'all': {
          events = await this.getErroredEvents()

          if (events.length === 0) {
            events = await this.getNewEvents(2000)
          }

          break
        }
      }

      if (events.length === 0) {
        await this.sleep(1000)
      }

      for (const event of events) {
        if (!this.discriminator.eventMatchesWhere(event)) {
          continue
        }

        yield event as unknown as RequestedEvents<Schema, ModelName, Opts>

        await this.acknowledgeEvent(event.id)
      }
    }
  }

  private hydratePayload(payload: any) {
    for (const [fieldName, field] of Object.entries(
      this.options.client.$schema.models[this.modelName]!.fields,
    )) {
      if (field.relation) {
        continue
      }

      if ([null, undefined, NaN].includes(payload[fieldName])) {
        payload[fieldName] = null
      }

      if (payload[fieldName] !== null) {
        switch (field.type) {
          case 'BigInt':
            payload[fieldName] = field.array
              ? (payload[fieldName] as string[]).map(value => BigInt(value))
              : BigInt(payload[fieldName])
            break
          case 'Int':
            payload[fieldName] = field.array
              ? (payload[fieldName] as string[]).map(value => Number(value))
              : Number(payload[fieldName])
            break
          case 'Decimal':
            payload[fieldName] = field.array
              ? (payload[fieldName] as DebeziumDecimal[]).map(value => debeziumDecimal(value))
              : debeziumDecimal(payload[fieldName])
            break
          case 'DateTime':
            payload[fieldName] = field.array
              ? (payload[fieldName] as string[]).map(value => new Date(Number(value) / 1000))
              : new Date(Number(payload[fieldName]) / 1000)
            break
          case 'Float':
            payload[fieldName] = field.array
              ? (payload[fieldName] as string[]).map(value => parseFloat(value))
              : parseFloat(payload[fieldName])
            break
          case 'Bytes':
            throw new Error(`Field "${fieldName}" has an unsupported type ("${field.type}")`)
        }
      }
    }
  }

  private parseStreamEntries(entries: StreamEntry[]): RecordEvent<Schema, ModelName>[] {
    const events: RecordEvent<Schema, ModelName>[] = []

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

        events.push({
          type: 'created',
          id: eventId,
          transactionId: String(event.source.txId),
          date: new Date(Number(event.ts_ms)),
          created: event.after,
        })
      } else if (operation === 'updated') {
        this.hydratePayload(event.before)
        this.hydratePayload(event.after)

        events.push({
          type: 'updated',
          id: eventId,
          transactionId: String(event.source.txId),
          date: new Date(Number(event.ts_ms)),
          updated: {
            before: event.before,
            after: event.after,
          },
        })
      } else {
        this.hydratePayload(event.before)

        events.push({
          type: 'deleted',
          id: eventId,
          transactionId: String(event.source.txId),
          date: new Date(Number(event.ts_ms)),
          deleted: event.before,
        })
      }
    }

    return events
  }

  private async getNewEvents(blockTimeout: number = 0): Promise<RecordEvent<Schema, ModelName>[]> {
    const xReadGroupResponse = (await this.options.redis.xreadgroup(
      'GROUP',
      this.consumerGroupName,
      this.consumerName,
      'COUNT',
      5,
      'BLOCK',
      blockTimeout,
      'STREAMS',
      this.streamName,
      '>',
    )) as XReadGroupResponse | null

    if (!xReadGroupResponse) return []

    const entries: StreamEntry[] = []

    for (const [, streamEntries] of xReadGroupResponse) {
      entries.push(...streamEntries)
    }

    return this.parseStreamEntries(entries)
  }

  private async getErroredEvents(): Promise<RecordEvent<Schema, ModelName>[]> {
    const result = (await this.options.redis.xautoclaim(
      this.streamName,
      this.consumerGroupName,
      this.consumerName,
      LiveStream.MIN_IDLE_TIME,
      '0-0',
      'COUNT',
      5,
    )) as unknown as XAutoClaimResult

    if (!result?.[1]?.length) return []

    return this.parseStreamEntries(result[1] as unknown as StreamEntry[])
  }
}

export class ZenStackLive<Schema extends SchemaDef> {
  private readonly options: ZenStackLiveOptions<Schema>
  private readonly redis: Redis

  constructor(options: ZenStackLiveOptions<Schema>) {
    this.options = options
    this.redis = new Redis(options.redis.url)
  }

  stream<ModelName extends GetModels<Schema>, Opts extends PickStreamFilters<Schema, ModelName>>(
    // streamOptions: Omit<LiveStreamOptions<Schema, ModelName>, 'schema' | 'redis' | 'clientId'>,
    streamOptions: {
      model: ModelName
      id: string
      consume?: LiveStreamConsumeOption
      rateLimit?: LiveStreamRateLimitOption
    } & Opts,
  ) {
    return new LiveStream<Schema, ModelName, Opts>({
      ...streamOptions,
      redis: this.redis,
      clientId: this.options.id ?? 'zenstack',
      client: this.options.client,
    })
  }

  disconnect() {
    this.redis.disconnect()
  }
}

export type BeforeAfterResult<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  before: SimplifiedPlainResult<Schema, ModelName> | null
  after: SimplifiedPlainResult<Schema, ModelName> | null
}

export function beforeAfter<Schema extends SchemaDef, ModelName extends GetModels<Schema>>(
  event: RecordEvent<Schema, ModelName>,
): BeforeAfterResult<Schema, ModelName> {
  if (event.type === 'created') {
    return {
      before: null,
      after: event.created,
    }
  } else if (event.type === 'updated') {
    return {
      before: event.updated.before,
      after: event.updated.after,
    }
  }

  return {
    before: event.deleted,
    after: null,
  }
}

function debeziumDecimal({ scale, value }: DebeziumDecimal) {
  const buf = Buffer.from(value, 'base64')

  let int = BigInt(0)

  for (const byte of buf) {
    int = (int << 8n) | BigInt(byte)
  }

  if (buf.length && buf[0]! & 0x80) {
    const bits = BigInt(buf.length * 8)
    int -= 1n << bits
  }

  const scaled = new Decimal(int.toString()).div(new Decimal(10).pow(Number(scale)))

  return scaled
}
