// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { schema } from './schemas/multi-schema'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { ZenStackLive } from '../src'
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { createIsolatedDatabase } from './isolated-database'

let client: ClientContract<typeof schema>
let live: ZenStackLive<typeof schema>
let redis: Redis

const lives: ZenStackLive<typeof schema>[] = []

async function isPublished(
  publication: string,
  schemaName: string,
  tableName: string,
  target = client,
) {
  const rows = await target.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM pg_publication_tables
     WHERE pubname = '${publication}' AND schemaname = '${schemaName}' AND tablename = '${tableName}'`,
  )

  return rows.length > 0
}

async function replicaIdentity(table: string) {
  const [row] = await client.$queryRawUnsafe<{ relreplident: string }[]>(
    `SELECT relreplident FROM pg_class WHERE oid = '${table}'::regclass`,
  )

  return row!.relreplident
}

// ZenStack's `$pushSchema` ignores `@@schema`, so these tables are created by hand.
async function createTables(target: ClientContract<typeof schema>) {
  await target.$queryRawUnsafe(`
    DROP SCHEMA IF EXISTS live_sales CASCADE;
    DROP SCHEMA IF EXISTS live_billing CASCADE;
    DROP TABLE IF EXISTS public."Invoice";
    CREATE SCHEMA live_sales;
    CREATE SCHEMA live_billing;
    CREATE TABLE live_sales."Customer" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE live_billing."Invoice" (id TEXT PRIMARY KEY, total INT NOT NULL);
    CREATE TABLE live_billing.ledger_entries (id TEXT PRIMARY KEY, total INT NOT NULL);
    CREATE TABLE public."Invoice" (id TEXT PRIMARY KEY, total INT NOT NULL);
  `)
}

beforeAll(async () => {
  client = new ZenStackClient(schema, {
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env['POSTGRES_URL'],
      }),
    }),
  })

  live = new ZenStackLive({
    client,

    redis: {
      url: process.env['REDIS_URL']!,
    },
  })

  redis = new Redis(process.env['REDIS_URL']!)

  await redis.flushall()
  await createTables(client)

  // A table is only captured from the moment that a stream publishes it.
  await Promise.all(
    (['Customer', 'Invoice', 'LedgerEntry', 'PublicInvoice'] as const).map(model =>
      live.stream({ model, slug: 'test-setup' })['prepare'](),
    ),
  )
})

afterAll(async () => {
  live.disconnect()
  redis.disconnect()

  for (const instance of lives) {
    instance.disconnect()
  }

  await client.$queryRawUnsafe(`
    DROP SCHEMA live_sales CASCADE;
    DROP SCHEMA live_billing CASCADE;
    DROP TABLE public."Invoice";
  `)

  await client.$disconnect()
})

describe('database schemas', () => {
  test('reads a model from the default schema', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Customer',
      slug: 'test-default-schema',
      when: { created: { id } },
    })

    await client.customer.create({ data: { id, name: 'Ada' } })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created).toEqual({ id, name: 'Ada' })
  }, 10000)

  test('reads a model from its @@schema', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'Invoice',
      slug: 'test-model-schema',
      when: { created: { id } },
    })

    await client.invoice.create({ data: { id, total: 1 } })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created).toEqual({ id, total: 1 })
  }, 10000)

  test('reads a model mapped to another table name', async () => {
    const id = randomUUID()

    const stream = live.stream({
      model: 'LedgerEntry',
      slug: 'test-mapped-table',
      when: { created: { id } },
    })

    await client.ledgerEntry.create({ data: { id, total: 1 } })

    const { value: event } = await stream[Symbol.asyncIterator]().next()

    expect(event.created).toEqual({ id, total: 1 })
  }, 10000)

  test('keeps tables with the same name in different schemas apart', async () => {
    const billingId = randomUUID()
    const publicId = randomUUID()

    // Both streams accept both rows, so a shared stream would hand them the wrong one.
    const when = { created: { total: { in: [100, 200] } } }

    const billingStream = live.stream({ model: 'Invoice', slug: 'test-same-name', when })
    const publicStream = live.stream({ model: 'PublicInvoice', slug: 'test-same-name', when })

    await client.publicInvoice.create({ data: { id: publicId, total: 100 } })
    await client.invoice.create({ data: { id: billingId, total: 200 } })

    const { value: billing } = await billingStream[Symbol.asyncIterator]().next()
    const { value: inPublic } = await publicStream[Symbol.asyncIterator]().next()

    expect(billing.created.id).toBe(billingId)
    expect(inPublic.created.id).toBe(publicId)
  }, 10000)

  test('sets the replica identity of the table in its own schema', async () => {
    const id = randomUUID()

    await client.$queryRawUnsafe('ALTER TABLE public."Invoice" REPLICA IDENTITY DEFAULT')
    await client.$queryRawUnsafe('ALTER TABLE live_billing."Invoice" REPLICA IDENTITY DEFAULT')

    const stream = live.stream({
      model: 'Invoice',
      slug: 'test-replica-identity',
      when: { deleted: { id } },
    })

    const iterator = stream[Symbol.asyncIterator]()
    const next = iterator.next()

    await new Promise(resolve => setTimeout(resolve, 300))

    expect(await replicaIdentity('live_billing."Invoice"')).toBe('f')
    expect(await replicaIdentity('public."Invoice"')).toBe('d')

    await client.invoice.create({ data: { id, total: 3 } })
    await client.invoice.delete({ where: { id } })

    const { value: event } = await next

    expect(event.deleted).toEqual({ id, total: 3 })
  }, 10000)
  describe('publication', () => {
    const publication = 'zenstack_live'

    let isolatedClient: ClientContract<typeof schema>

    beforeAll(async () => {
      isolatedClient = new ZenStackClient(schema, {
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: await createIsolatedDatabase('zenstack_live_test_publication'),
          }),
        }),
      })

      await createTables(isolatedClient)
    })

    afterEach(async () => {
      await isolatedClient.$queryRawUnsafe(`DROP PUBLICATION IF EXISTS ${publication}`)
    })

    afterAll(async () => {
      await isolatedClient.$disconnect()
    })

    function makeStream(model: 'Invoice' | 'LedgerEntry') {
      const instance = new ZenStackLive({
        client: isolatedClient,
        redis: { url: process.env['REDIS_URL']! },
      })

      lives.push(instance)

      return instance.stream({ model, slug: 'test-publication' })
    }

    test('uses zenstack_live by default', async () => {
      await expect(isPublished('zenstack_live', 'live_billing', 'Invoice')).resolves.toBe(true)
      await expect(isPublished('zenstack_live', 'live_billing', 'ledger_entries')).resolves.toBe(
        true,
      )
    })

    test('creates the publication when it does not exist', async () => {
      await makeStream('Invoice')['prepare']()

      await expect(
        isPublished(publication, 'live_billing', 'Invoice', isolatedClient),
      ).resolves.toBe(true)
      await expect(isPublished(publication, 'public', 'Invoice', isolatedClient)).resolves.toBe(
        false,
      )
    })

    test('adds the table to an empty publication', async () => {
      await isolatedClient.$queryRawUnsafe(`CREATE PUBLICATION ${publication}`)
      await makeStream('Invoice')['prepare']()

      await expect(
        isPublished(publication, 'live_billing', 'Invoice', isolatedClient),
      ).resolves.toBe(true)
    })

    test('keeps the tables that are already published', async () => {
      await makeStream('Invoice')['prepare']()
      await makeStream('LedgerEntry')['prepare']()

      await expect(
        isPublished(publication, 'live_billing', 'Invoice', isolatedClient),
      ).resolves.toBe(true)
      await expect(
        isPublished(publication, 'live_billing', 'ledger_entries', isolatedClient),
      ).resolves.toBe(true)
    })

    test('can prepare the same table twice', async () => {
      const stream = makeStream('Invoice')

      await stream['prepare']()
      await expect(stream['prepare']()).resolves.toBeUndefined()
    })

    test('can prepare different tables at the same time', async () => {
      await Promise.all(
        (['Invoice', 'LedgerEntry', 'Invoice', 'LedgerEntry'] as const).map(model =>
          makeStream(model)['prepare'](),
        ),
      )

      await expect(
        isPublished(publication, 'live_billing', 'Invoice', isolatedClient),
      ).resolves.toBe(true)
      await expect(
        isPublished(publication, 'live_billing', 'ledger_entries', isolatedClient),
      ).resolves.toBe(true)
    })

    test('leaves a publication for all tables as it is', async () => {
      await isolatedClient.$queryRawUnsafe(`CREATE PUBLICATION ${publication} FOR ALL TABLES`)

      await expect(makeStream('Invoice')['prepare']()).resolves.toBeUndefined()
    })
  })
})
