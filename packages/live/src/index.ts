/* eslint-disable */

import type { SchemaDef, GetModels, FieldDef } from '@zenstackhq/schema'
import {
  AnyNullClass,
  DbNullClass,
  JsonNullClass,
  type WhereInput,
  type SimplifiedPlainResult,
  type ClientContract,
} from '@zenstackhq/orm'
import { parse } from 'lossless-json'
import { Redis } from 'ioredis'
import Decimal from 'decimal.js'
import hash from 'stable-hash'
import { Buffer } from 'node:buffer'
import type {
  XReadGroupResponse,
  XAutoClaimResult,
  StreamEntry,
  DebeziumShortEventType,
  StrictOmit,
  RecordedStream,
} from './internal'
import { sourceValues } from './internal'
import { EventDiscriminator } from './event-discriminator'

const DEFAULT_PUBLICATION = 'zenstack_live'
const DEFAULT_RETENTION = 24 * 60 * 60 * 1000
const TRIM_INTERVAL = 60 * 1000
const READ_TIMEOUT = 2000
const STREAM_PREFIX = 'zenstack.table.'
const RECORDED_STREAMS_KEY = 'zenstack.metadata.streams'

// Blocks that change the publication check it first, so they have to run one at a time. Otherwise
// two of them can both find the publication missing, and the second fails to create it.
const LOCK_PUBLICATION = `PERFORM pg_advisory_xact_lock(hashtext(${quoteLiteral(DEFAULT_PUBLICATION)}));`

// This has to be atomic, because a stream that comes back between a check and `DEL` would lose its
// consumer group.
const DELETE_UNUSED_STREAM = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return 1
  end

  if #redis.call('XINFO', 'GROUPS', KEYS[1]) > 0 then
    return 0
  end

  return redis.call('DEL', KEYS[1])
`

const operationMap: Record<DebeziumShortEventType, DatabaseEventType> = {
  c: 'created',
  u: 'updated',
  d: 'deleted',
}

export type DatabaseEventType = 'created' | 'updated' | 'deleted'
export type LiveStreamConsumeOption = 'new' | 'errored' | 'all'

export type LiveStreamWhen<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  created?: WhereInput<Schema, ModelName, {}, true>
  updated?: {
    before?: WhereInput<Schema, ModelName, {}, true>
    after?: WhereInput<Schema, ModelName, {}, true>
  }
  deleted?: WhereInput<Schema, ModelName, {}, true>
}

export type LiveStreamOptions<Schema extends SchemaDef, ModelName extends GetModels<Schema>> = {
  model: ModelName
  redis: Redis
  client: ClientContract<Schema>
  slug: string
  clientId: string

  /**
   * Which events to read. `new` reads events that haven't been delivered, `errored` retries events
   * that were delivered but never acknowledged, and `all` does both. Defaults to `all`, which means
   * that an event can be delivered more than once, so handlers need to be idempotent.
   */
  consume?: LiveStreamConsumeOption

  /**
   * How long an event can go unacknowledged before it's retried, in milliseconds. This should be
   * longer than your handler takes, otherwise another instance will process the event as well.
   */
  timeout?: number
  retention?: number
  when?: LiveStreamWhen<Schema, ModelName>
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

export type RequestedEventType<When> = {} extends When
  ? DatabaseEventType
  : keyof When & DatabaseEventType

export type ZenStackLiveOptions<Schema extends SchemaDef> = {
  client: ClientContract<Schema>

  /**
   * This client's unique ID. Used for horizontal scaling.
   */
  id?: string

  /**
   * How long events are kept in Redis, in milliseconds. Defaults to 24 hours. A stream that's offline
   * for longer misses what it didn't read, and events waiting to be retried are dropped. Events are
   * shared by every stream on a model, so the shortest value in use is the one that takes effect.
   */
  retention?: number

  redis: {
    url: string
  }
}

export type LivePruneOptions = {
  /**
   * How long a stream has to be gone before it's removed, in milliseconds. This can't be shorter than
   * `retention`, because a stream that comes back after being removed starts from new events, and
   * loses what Redis was still keeping for it. A stream's own `retention` is respected if it's longer.
   */
  olderThan: number

  /**
   * Reports what would be removed without changing anything. Defaults to `false`.
   */
  dryRun?: boolean
}

export type PrunedStream = {
  /**
   * Missing for streams last run by a version of LIVE that didn't record them.
   */
  slug?: string
  model?: string
  redisStream: string
  consumerGroup: string
  lastSeenAt: Date | null
}

export type PrunedConsumer = {
  name: string
  redisStream: string
  consumerGroup: string
  lastSeenAt: Date
}

export type PrunedTable = {
  /**
   * Missing if the Redis stream is left over from a table that's no longer published.
   */
  table?: { schema: string; name: string }
  redisStream: string

  /**
   * LIVE doesn't know what this was before the table had a stream, so it's left for you to restore.
   */
  replicaIdentityFull: boolean
}

export type LivePruneReport = {
  dryRun: boolean

  /**
   * Streams that were removed.
   */
  streams: PrunedStream[]

  /**
   * Consumers that were removed from streams that are still in use.
   */
  consumers: PrunedConsumer[]

  /**
   * Tables that were dropped from the publication, along with their events.
   */
  tables: PrunedTable[]

  /**
   * Streams that were kept, because nothing shows when they were last used.
   */
  unknownStreams: PrunedStream[]

  /**
   * Tables with no streams left that were kept, because a publication that's `FOR ALL TABLES` can't
   * drop individual tables. Their events are removed once they're older than `retention`.
   */
  allTables: PrunedTable[]
}

type PublishedTable = {
  schemaName: string
  tableName: string
  allTables: boolean
  replicaIdentityFull: boolean
}

type ConsumerGroupInfo = {
  name: string
  consumers: { name: string; pending: number; idle: number }[]
}

export class LiveStream<
  Schema extends SchemaDef,
  ModelName extends GetModels<Schema>,
  EventType extends DatabaseEventType = DatabaseEventType,
> implements AsyncIterable<RecordResultMap<Schema, ModelName>[EventType]> {
  private readonly options: LiveStreamOptions<Schema, ModelName>
  private readonly modelName: ModelName
  private readonly databaseSchema: string
  private readonly tableName: string
  private readonly streamName: string
  private readonly consumerName: string
  private readonly consumerGroupName: string
  private readonly discriminator: EventDiscriminator<Schema, ModelName>
  private readonly timeout: number
  private readonly retention: number
  private trimmedAt = 0

  readonly id: string

  constructor(options: LiveStreamOptions<Schema, ModelName>) {
    const hashed = hash({
      id: options.slug,
      model: options.model,
      created: hashableFilter(options.when?.created),
      updated: hashableFilter(options.when?.updated),
      deleted: hashableFilter(options.when?.deleted),
    })

    this.options = options
    this.timeout = options.timeout ?? 30000
    this.retention = options.retention ?? DEFAULT_RETENTION
    this.modelName = options.model
    this.databaseSchema = getDatabaseSchema(options.client.$schema, options.model)
    this.tableName = getTableName(options.client.$schema, options.model)
    this.streamName = `${STREAM_PREFIX}${this.databaseSchema}.${this.tableName}`
    this.consumerName = `zenstack.${options.clientId}`
    this.consumerGroupName = `${this.streamName}.${hashed}`
    this.discriminator = new EventDiscriminator(options)
    this.id = hashed

    // Create the consumer group now, otherwise events written before iteration starts are skipped.
    // Failures are ignored here because they resurface when iteration calls `prepare` again.
    this.prepare().catch(() => {})
  }

  // The order matters to `prune`, which reads records before consumer groups, and drops tables with
  // no consumer groups. So a group has to exist before its record, and before the table is checked.
  private async prepare() {
    await this.makeConsumerGroup()
    await this.recordStream()
    await this.captureTable()
  }

  private async recordStream() {
    const recorded: RecordedStream = {
      slug: this.options.slug,
      model: this.modelName,
      redisStream: this.streamName,
      retention: this.retention,
      preparedAt: Date.now(),
    }

    await this.options.redis.hset(
      RECORDED_STREAMS_KEY,
      this.consumerGroupName,
      JSON.stringify(recorded),
    )
  }

  // This is one block so that `ALTER TABLE` holds its lock until the table is published. Otherwise a
  // write in between could be captured without its full previous row.
  private async captureTable() {
    const table = `${quoteIdentifier(this.databaseSchema)}.${quoteIdentifier(this.tableName)}`
    const publication = quoteIdentifier(DEFAULT_PUBLICATION)

    await this.options.client.$queryRawUnsafe(`
      DO $do$
      DECLARE
        all_tables boolean;
      BEGIN
        ${LOCK_PUBLICATION}

        ALTER TABLE ${table} REPLICA IDENTITY FULL;

        SELECT puballtables INTO all_tables
        FROM pg_publication
        WHERE pubname = ${quoteLiteral(DEFAULT_PUBLICATION)};

        IF NOT FOUND THEN
          CREATE PUBLICATION ${publication} FOR TABLE ${table};
        ELSIF NOT all_tables AND NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = ${quoteLiteral(DEFAULT_PUBLICATION)}
            AND schemaname = ${quoteLiteral(this.databaseSchema)}
            AND tablename = ${quoteLiteral(this.tableName)}
        ) THEN
          ALTER PUBLICATION ${publication} ADD TABLE ${table};
        END IF;
      END
      $do$
    `)
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

  // Every stream on a model reads the same entries, so acknowledging one has to leave it in place
  // for the streams that haven't read it yet. `trimEvents` is what removes entries.
  private async acknowledgeEvents(eventIds: string[]) {
    if (eventIds.length > 0) {
      await this.options.redis.xack(this.streamName, this.consumerGroupName, ...eventIds)
    }
  }

  private async trimEvents() {
    if (Date.now() - this.trimmedAt < TRIM_INTERVAL) {
      return
    }

    this.trimmedAt = Date.now()

    const oldestId = `${this.trimmedAt - this.retention}-0`

    // Nothing can be retried once it's gone, so what's still pending has to be dropped first.
    const expired = (await this.options.redis.xpending(
      this.streamName,
      this.consumerGroupName,
      '-',
      `(${oldestId}`,
      1000,
    )) as [string, ...unknown[]][]

    await this.acknowledgeEvents(expired.map(([eventId]) => eventId))
    await this.options.redis.xtrim(this.streamName, 'MINID', oldestId)
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

  async *[Symbol.asyncIterator](): AsyncIterator<RecordResultMap<Schema, ModelName>[EventType]> {
    await this.prepare()

    const consume = this.options.consume ?? 'all'

    while (this.options.redis.status === 'ready') {
      await this.trimEvents()

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
            events = await this.getNewEvents()
          }

          break
        }
      }

      if (events.length === 0) {
        await this.sleep(1000)
      }

      for (const event of events) {
        if (!this.discriminator.eventMatchesWhere(event)) {
          await this.acknowledgeEvents([event.id])
          continue
        }

        yield event as RecordResultMap<Schema, ModelName>[EventType]

        await this.acknowledgeEvents([event.id])
      }
    }
  }

  private hydratePayload(payload: any) {
    const sources: Record<string, unknown> = {}

    Object.defineProperty(payload, sourceValues, { value: sources })

    for (const [fieldName, field] of Object.entries(
      this.options.client.$schema.models[this.modelName]!.fields,
    )) {
      if (field.relation) {
        continue
      }

      if ([null, undefined, NaN].includes(payload[fieldName])) {
        payload[fieldName] = null
      }

      // ZenStack reads NULL arrays as empty.
      if (field.array && payload[fieldName] === null) {
        sources[fieldName] = undefined
        payload[fieldName] = []
        continue
      }

      if (payload[fieldName] !== null) {
        const typeDef = this.options.client.$schema.typeDefs?.[field.type]

        if (typeDef && !typeDef.base) {
          sources[fieldName] = JSON.parse(payload[fieldName])
          payload[fieldName] = this.hydrateJson(field, JSON.parse(payload[fieldName]))
          continue
        }

        switch (typeDef?.base ?? field.type) {
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
              ? (payload[fieldName] as string[]).map(value => debeziumDecimal(value))
              : debeziumDecimal(payload[fieldName])
            break
          case 'DateTime':
            payload[fieldName] = field.array
              ? (payload[fieldName] as string[]).map(value => debeziumDate(value))
              : debeziumDate(payload[fieldName])
            break
          case 'Float':
            payload[fieldName] = field.array
              ? (payload[fieldName] as string[]).map(value => parseFloat(value))
              : parseFloat(payload[fieldName])
            break
          case 'Json':
            payload[fieldName] = field.array
              ? (payload[fieldName] as string[]).map(value => JSON.parse(value))
              : JSON.parse(payload[fieldName])

            if (!field.array) {
              sources[fieldName] = payload[fieldName]
            }

            break
          case 'Bytes':
            payload[fieldName] = field.array
              ? (payload[fieldName] as string[]).map(value => debeziumBytes(value))
              : debeziumBytes(payload[fieldName])
            break
        }
      }
    }
  }

  // Debezium doesn't encode the contents of a JSON column, but nothing guarantees they match the
  // custom type either, and a malformed value shouldn't take down the stream.
  private hydrateJson(field: FieldDef, value: any): unknown {
    if (value === null || value === undefined) {
      return value
    }

    if (field.array) {
      return Array.isArray(value)
        ? value.map(item => this.hydrateJson({ ...field, array: false }, item))
        : value
    }

    const typeDef = this.options.client.$schema.typeDefs?.[field.type]

    if (typeDef && !typeDef.base) {
      if (typeof value === 'object') {
        for (const [name, nestedField] of Object.entries(typeDef.fields)) {
          if (name in value) {
            value[name] = this.hydrateJson(nestedField, value[name])
          }
        }
      }

      return value
    }

    try {
      switch (typeDef?.base ?? field.type) {
        case 'BigInt':
          return BigInt(value)
        case 'Decimal':
          return new Decimal(value)
        case 'DateTime':
          return new Date(value)
        default:
          return value
      }
    } catch {
      return value
    }
  }

  private async parseStreamEntries(
    entries: StreamEntry[],
  ): Promise<RecordEvent<Schema, ModelName>[]> {
    const events: RecordEvent<Schema, ModelName>[] = []
    const skippedIds: string[] = []

    for (const [eventId, fields] of entries) {
      const [, eventJson] = fields

      if (eventJson === 'default') {
        skippedIds.push(eventId)
        continue
      }

      let event = this.parseJson<any>(eventJson)

      if (!event) {
        skippedIds.push(eventId)
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

    await this.acknowledgeEvents(skippedIds)

    return events
  }

  // This can't block indefinitely, otherwise a stream on a quiet table would stop trimming, hold up
  // the streams sharing its connection, and look abandoned to `prune`.
  private async getNewEvents(): Promise<RecordEvent<Schema, ModelName>[]> {
    const xReadGroupResponse = (await this.options.redis.xreadgroup(
      'GROUP',
      this.consumerGroupName,
      this.consumerName,
      'COUNT',
      5,
      'BLOCK',
      READ_TIMEOUT,
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
      this.timeout,
      '0-0',
      'COUNT',
      5,
    )) as unknown as XAutoClaimResult

    if (!result?.[1]?.length) return []

    // Redis 6 returns null for an entry that's pending but has since been trimmed.
    const entries = (result[1] as unknown as (StreamEntry | null)[]).filter(entry => entry !== null)

    return this.parseStreamEntries(entries)
  }
}

export class ZenStackLive<Schema extends SchemaDef> {
  private readonly options: ZenStackLiveOptions<Schema>
  private readonly redis: Redis

  // Streams block on `redis`, which would hold up everything else sent over it.
  private readonly maintenanceRedis: Redis
  private readonly trimTimer: NodeJS.Timeout
  private trimming = false

  constructor(options: ZenStackLiveOptions<Schema>) {
    this.options = options
    this.redis = new Redis(options.redis.url)
    this.maintenanceRedis = new Redis(options.redis.url, { lazyConnect: true })
    this.trimTimer = setInterval(() => void this.runTrim(), TRIM_INTERVAL)
    this.trimTimer.unref()
  }

  stream<
    ModelName extends GetModels<Schema>,
    When extends LiveStreamWhen<Schema, ModelName>,
  >(streamOptions: {
    model: ModelName
    slug: string

    /**
     * Which events to read. `new` reads events that haven't been delivered, `errored` retries events
     * that were delivered but never acknowledged, and `all` does both. Defaults to `all`, which means
     * that an event can be delivered more than once, so handlers need to be idempotent.
     */
    consume?: LiveStreamConsumeOption

    /**
     * How long an event can go unacknowledged before it's retried, in milliseconds. This should be
     * longer than your handler takes, otherwise another instance will process the event as well.
     */
    timeout?: number

    /**
     * The events to listen for. All events are listened for if this is omitted or empty.
     */
    when?: When
  }) {
    return new LiveStream<Schema, ModelName, RequestedEventType<When>>({
      ...streamOptions,
      redis: this.redis,
      clientId: this.options.id ?? 'zenstack',
      retention: this.options.retention,
      client: this.options.client,
    })
  }

  /**
   * Removes what's left behind by streams that are gone. A stream that's offline looks the same as one
   * that's been deleted, so this goes by how long it's been gone. Run it with `dryRun` first.
   */
  async prune({ olderThan, dryRun = false }: LivePruneOptions): Promise<LivePruneReport> {
    const retention = this.options.retention ?? DEFAULT_RETENTION

    if (olderThan < retention) {
      throw new Error(`olderThan (${olderThan}) can't be shorter than retention (${retention})`)
    }

    const report: LivePruneReport = {
      dryRun,
      streams: [],
      consumers: [],
      tables: [],
      unknownStreams: [],
      allTables: [],
    }

    const redis = this.maintenanceRedis
    const now = Date.now()

    // Streams record themselves after creating their consumer group, so reading this first means that
    // a record without a group below really is left over.
    const recordedStreams = await this.getRecordedStreams()
    const orphanedRecords = new Set(recordedStreams.keys())
    const publishedTables = new Map(
      (await this.getPublishedTables()).map(table => [getRedisStream(table), table]),
    )

    for (const redisStream of new Set([...publishedTables.keys(), ...(await this.scanStreams())])) {
      let groupsLeft = 0

      for (const group of await this.getConsumerGroups(redisStream)) {
        const recorded = recordedStreams.get(group.name)
        const threshold = Math.max(olderThan, recorded?.retention ?? 0)
        const lastSeen = getLastSeen(group, recorded, now)
        const stream: PrunedStream = {
          slug: recorded?.slug,
          model: recorded?.model,
          redisStream,
          consumerGroup: group.name,
          lastSeenAt: lastSeen === null ? null : new Date(lastSeen),
        }

        orphanedRecords.delete(group.name)

        if (lastSeen === null) {
          report.unknownStreams.push(stream)
          groupsLeft++
          continue
        }

        if (now - lastSeen >= threshold) {
          report.streams.push(stream)

          if (!dryRun) {
            await redis.xgroup('DESTROY', redisStream, group.name)
            await redis.hdel(RECORDED_STREAMS_KEY, group.name)
          }

          continue
        }

        groupsLeft++

        for (const consumer of group.consumers) {
          if (consumer.pending === 0 && consumer.idle >= threshold) {
            report.consumers.push({
              name: consumer.name,
              redisStream,
              consumerGroup: group.name,
              lastSeenAt: new Date(now - consumer.idle),
            })

            if (!dryRun) {
              await redis.xgroup('DELCONSUMER', redisStream, group.name, consumer.name)
            }
          }
        }
      }

      if (groupsLeft > 0) {
        continue
      }

      const published = publishedTables.get(redisStream)
      const table: PrunedTable = {
        table: published && { schema: published.schemaName, name: published.tableName },
        redisStream,
        replicaIdentityFull: published?.replicaIdentityFull ?? false,
      }

      if (published?.allTables) {
        report.allTables.push(table)
      } else if (dryRun || (await this.removeTable(redisStream, published))) {
        report.tables.push(table)
      }
    }

    if (!dryRun && orphanedRecords.size > 0) {
      await redis.hdel(RECORDED_STREAMS_KEY, ...orphanedRecords)
    }

    return report
  }

  // Dropping the table comes first, otherwise Debezium could recreate the Redis stream. A stream that
  // comes back at any point here either finds its table unpublished and adds it again, or has a
  // consumer group by the time `DELETE_UNUSED_STREAM` runs, which is why the table is restored.
  private async removeTable(redisStream: string, published: PublishedTable | undefined) {
    if ((await this.getConsumerGroups(redisStream)).length > 0) {
      return false
    }

    if (published) {
      await this.updatePublication(published, 'DROP')
    }

    const deleted = await this.maintenanceRedis.eval(DELETE_UNUSED_STREAM, 1, redisStream)

    if (deleted === 0 && published) {
      await this.updatePublication(published, 'ADD')
    }

    return deleted !== 0
  }

  private async updatePublication(table: PublishedTable, action: 'ADD' | 'DROP') {
    await this.options.client.$queryRawUnsafe(`
      DO $do$
      BEGIN
        ${LOCK_PUBLICATION}

        IF ${action === 'ADD' ? 'NOT' : ''} EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = ${quoteLiteral(DEFAULT_PUBLICATION)}
            AND schemaname = ${quoteLiteral(table.schemaName)}
            AND tablename = ${quoteLiteral(table.tableName)}
        ) THEN
          ALTER PUBLICATION ${quoteIdentifier(DEFAULT_PUBLICATION)}
          ${action} TABLE ${quoteIdentifier(table.schemaName)}.${quoteIdentifier(table.tableName)};
        END IF;
      END
      $do$
    `)
  }

  private async runTrim() {
    if (this.trimming) {
      return
    }

    this.trimming = true

    try {
      await this.trimTables()
    } catch (error) {
      console.warn('[zenstack-live] Failed to trim events, trying again in a minute.', error)
    } finally {
      this.trimming = false
    }
  }

  // Streams only trim while they're running, and Debezium keeps writing to a table after its last
  // stream is gone. This covers every published table, even those that never had a stream. Using the
  // longest retention recorded for a table means that streams in use never lose anything to this, so
  // it doesn't matter whether a table's streams are running.
  private async trimTables() {
    const [tables, recordedStreams] = await Promise.all([
      this.getPublishedTables(),
      this.getRecordedStreams(),
    ])

    const retentions = new Map<string, number>()

    for (const { redisStream, retention } of recordedStreams.values()) {
      retentions.set(redisStream, Math.max(retention, retentions.get(redisStream) ?? 0))
    }

    const now = Date.now()
    const pipeline = this.maintenanceRedis.pipeline()

    for (const table of tables) {
      const redisStream = getRedisStream(table)
      const retention = retentions.get(redisStream) ?? this.options.retention ?? DEFAULT_RETENTION

      pipeline.xtrim(redisStream, 'MINID', `${now - retention}-0`)
    }

    await pipeline.exec()
  }

  private async getPublishedTables() {
    return await this.options.client.$queryRawUnsafe<PublishedTable[]>(`
      SELECT
        t.schemaname AS "schemaName",
        t.tablename AS "tableName",
        p.puballtables AS "allTables",
        c.relreplident = 'f' AS "replicaIdentityFull"
      FROM pg_publication_tables t
      JOIN pg_publication p ON p.pubname = t.pubname
      JOIN pg_namespace n ON n.nspname = t.schemaname
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.tablename
      WHERE t.pubname = ${quoteLiteral(DEFAULT_PUBLICATION)}
    `)
  }

  private async getRecordedStreams() {
    const recorded = await this.maintenanceRedis.hgetall(RECORDED_STREAMS_KEY)

    return new Map(
      Object.entries(recorded).map(([consumerGroup, json]) => [
        consumerGroup,
        JSON.parse(json) as RecordedStream,
      ]),
    )
  }

  private async scanStreams() {
    const redisStreams: string[] = []
    let cursor = '0'

    do {
      const [nextCursor, keys] = await this.maintenanceRedis.scan(
        cursor,
        'MATCH',
        `${STREAM_PREFIX}*`,
        'COUNT',
        1000,
        'TYPE',
        'stream',
      )

      cursor = nextCursor
      redisStreams.push(...keys)
    } while (cursor !== '0')

    return redisStreams
  }

  private async getConsumerGroups(redisStream: string): Promise<ConsumerGroupInfo[]> {
    const redis = this.maintenanceRedis
    let groups: unknown[][]

    try {
      groups = (await redis.xinfo('GROUPS', redisStream)) as unknown[][]
    } catch (error) {
      if (error instanceof Error && error.message.includes('no such key')) {
        return []
      }

      throw error
    }

    return await Promise.all(
      groups.map(async group => {
        const name = String(fromReplyPairs(group)['name'])
        const consumers = (await redis.xinfo('CONSUMERS', redisStream, name)) as unknown[][]

        return {
          name,
          consumers: consumers.map(consumer => {
            const fields = fromReplyPairs(consumer)

            return {
              name: String(fields['name']),
              pending: Number(fields['pending']),
              idle: Number(fields['idle']),
            }
          }),
        }
      }),
    )
  }

  disconnect() {
    clearInterval(this.trimTimer)
    this.maintenanceRedis.disconnect()
    this.redis.disconnect()
  }
}

// Structural because inferring `Schema` and `ModelName` from an event exceeds the compiler's
// stack depth (TS2321) when comparing `SimplifiedPlainResult`.
export type BeforeAfterEvent =
  | { type: 'created'; created: unknown }
  | { type: 'updated'; updated: { before: unknown; after: unknown } }
  | { type: 'deleted'; deleted: unknown }

export type BeforeAfterResult<Event extends BeforeAfterEvent> = Event extends {
  type: 'created'
  created: infer Row
}
  ? { before: null; after: Row }
  : Event extends { type: 'updated'; updated: infer Updated }
    ? Updated
    : Event extends { type: 'deleted'; deleted: infer Row }
      ? { before: Row; after: null }
      : never

export function beforeAfter<Event extends BeforeAfterEvent>(event: Event): BeforeAfterResult<Event>
export function beforeAfter(event: BeforeAfterEvent) {
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

function getRedisStream({ schemaName, tableName }: PublishedTable) {
  return `${STREAM_PREFIX}${schemaName}.${tableName}`
}

// `idle` covers empty reads and claims as well, so it stays low for a stream on a quiet table. A group
// has no consumers until its first read, which is what `preparedAt` is for.
function getLastSeen(group: ConsumerGroupInfo, recorded: RecordedStream | undefined, now: number) {
  const seen = group.consumers.map(({ idle }) => now - idle)

  if (recorded) {
    seen.push(recorded.preparedAt)
  }

  return seen.length > 0 ? Math.max(...seen) : null
}

function fromReplyPairs(reply: unknown[]) {
  const fields: Record<string, unknown> = {}

  for (let i = 0; i < reply.length; i += 2) {
    fields[String(reply[i])] = reply[i + 1]
  }

  return fields
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function getModelAttribute(schema: SchemaDef, model: string, attribute: string, arg: string) {
  const value = schema.models[model]!.attributes?.find(
    ({ name }) => name === attribute,
  )?.args?.find(({ name }) => name === arg)?.value

  return value?.kind === 'literal' ? String(value.value) : undefined
}

// These follow how ZenStack resolves a model, because Debezium names streams after the real table.
function getDatabaseSchema(schema: SchemaDef, model: string) {
  return (
    getModelAttribute(schema, model, '@@schema', 'map') ?? schema.provider.defaultSchema ?? 'public'
  )
}

function getTableName(schema: SchemaDef, model: string) {
  return getModelAttribute(schema, model, '@@map', 'name') ?? model
}

// `stable-hash` tells objects apart with a counter unless they're plain, and that differs between
// processes, so instances of the same stream would end up in different consumer groups.
function hashableFilter(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => hashableFilter(item))
  }

  if (Decimal.isDecimal(value)) {
    return `Decimal(${value.toString()})`
  }

  if (value instanceof Uint8Array) {
    return `Bytes(${Buffer.from(value).toString('hex')})`
  }

  if (
    value instanceof DbNullClass ||
    value instanceof JsonNullClass ||
    value instanceof AnyNullClass
  ) {
    return value.constructor.name
  }

  if (typeof value === 'object' && value !== null && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, hashableFilter(item)]),
    )
  }

  return value
}

function debeziumDecimal(value: string) {
  switch (value) {
    case 'NAN':
      return new Decimal(NaN)
    case 'POSITIVE_INFINITY':
      return new Decimal(Infinity)
    case 'NEGATIVE_INFINITY':
      return new Decimal(-Infinity)
    default:
      return new Decimal(value)
  }
}

// `TIME` columns have no date, and ZenStack places them on the epoch.
function debeziumDate(value: string) {
  return new Date(/^\d{2}:/.test(value) ? `1970-01-01T${value}` : value)
}

function debeziumBytes(value: string) {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}
