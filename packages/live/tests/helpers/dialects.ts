import type { SchemaDef } from '@zenstackhq/schema'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { MysqlDialect, PostgresDialect } from 'kysely'
import { Client, Pool } from 'pg'
import { createPool } from 'mysql2'
import { createConnection } from 'mysql2/promise'
import { getRedisKeys, type LiveDialect } from '../../src'

// How tests reach one kind of database. The main database is the one Debezium captures, and isolated
// ones are for tests that change what's captured, or that would otherwise disturb Debezium.
export type TestDialect = {
  name: LiveDialect
  url: () => string
  createIsolatedDatabase: (name: string) => Promise<string>
  connect: (schema: SchemaDef, url: string) => ClientContract<SchemaDef>

  // Gives a schema written for Postgres to this dialect.
  moveSchema: (schema: SchemaDef) => SchemaDef

  // What Debezium names a database's streams after: Postgres's schema, or MySQL's database.
  schemaName: (url: string) => string

  // Removes a table along with what it needs, like the types of its enums on Postgres.
  dropTables: (client: ClientContract<SchemaDef>, schema: SchemaDef) => Promise<void>
}

function getTables(schema: SchemaDef) {
  return Object.values(schema.models).map(model => {
    const mapped = model.attributes?.find(({ name }) => name === '@@map')?.args?.[0]?.value

    return mapped?.kind === 'literal' ? String(mapped.value) : model.name
  })
}

function withDatabase(url: string, name: string) {
  const parsed = new URL(url)

  parsed.pathname = `/${name}`

  return parsed.toString()
}

const COMMON_SCHEMA = 'live_common'

// A replication slot looks publications up as of the WAL it's reading, so one that's been dropped
// stops the slot for good, even once it's recreated. Publications and slots belong to a database, so
// tests that drop the publication run in their own, where they can't reach Debezium's slot.
export const postgres: TestDialect = {
  name: 'postgres',
  url: () => process.env['POSTGRES_URL']!,

  async createIsolatedDatabase(name) {
    const admin = new Client({ connectionString: postgres.url() })

    await admin.connect()

    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name}`)
      await admin.query(`CREATE DATABASE ${name}`)
    } finally {
      await admin.end()
    }

    return withDatabase(postgres.url(), name)
  },

  // `$pushSchema` creates tables wherever the search path points, while queries go to the default
  // schema, so both are set for a schema that has one.
  connect: (schema, url) => {
    const {defaultSchema} = schema.provider

    return new ZenStackClient(schema, {
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          options: defaultSchema ? `-c search_path=${defaultSchema}` : undefined,
        }),
      }),
    })
  },

  // ZenStack names constraints after models, which would clash with the Postgres test schemas.
  moveSchema: schema => ({
    ...schema,
    provider: { ...schema.provider, type: 'postgresql', defaultSchema: COMMON_SCHEMA },
  }),

  schemaName: () => COMMON_SCHEMA,

  async dropTables(client) {
    await client.$queryRawUnsafe(`DROP SCHEMA IF EXISTS ${COMMON_SCHEMA} CASCADE`)
    await client.$queryRawUnsafe(`CREATE SCHEMA ${COMMON_SCHEMA}`)
  },
}

// Debezium only captures the database in its `DATABASE_URL`, which `MYSQL_URL` has to match.
// Isolated databases aren't captured at all.
export const mysql: TestDialect = {
  name: 'mysql',
  url: () => process.env['MYSQL_URL']!,

  async createIsolatedDatabase(name) {
    const admin = await createConnection(mysql.url())

    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``)
      await admin.query(`CREATE DATABASE \`${name}\``)
    } finally {
      await admin.end()
    }

    return withDatabase(mysql.url(), name)
  },

  connect: (schema, url) =>
    new ZenStackClient(schema, {
      dialect: new MysqlDialect({ pool: createPool({ uri: url, connectionLimit: 5 }) }),
    }),

  moveSchema: schema => ({ ...schema, provider: { type: 'mysql' } }),

  schemaName: url => decodeURIComponent(new URL(url).pathname.slice(1)),

  async dropTables(client, schema) {
    for (const table of getTables(schema)) {
      await client.$queryRawUnsafe(`DROP TABLE IF EXISTS \`${table}\``)
    }
  },
}

export const dialects = [postgres, mysql]

// Stream names only depend on the database, so tests can know them before connecting.
export function getStreamName(dialect: TestDialect, table: string, url = dialect.url()) {
  return `${getRedisKeys(dialect.name).streamPrefix}${dialect.schemaName(url)}.${table}`
}

export type TestDatabase<Schema extends SchemaDef> = {
  dialect: TestDialect
  client: ClientContract<Schema>
  schemaName: string
  recordedStreams: string
  streamName: (table: string) => string
}

// Schemas are written for Postgres, and moved to the dialect here. Tests keep the Postgres types,
// which only differ in the provider.
export async function createTestDatabase<Schema extends SchemaDef>(
  dialect: TestDialect,
  schema: Schema,
  options: { isolated?: string } = {},
): Promise<TestDatabase<Schema>> {
  const url = options.isolated
    ? await dialect.createIsolatedDatabase(options.isolated)
    : dialect.url()
  const moved = dialect.moveSchema(schema)
  const client = dialect.connect(moved, url) as unknown as ClientContract<Schema>

  await dialect.dropTables(client as unknown as ClientContract<SchemaDef>, moved)
  await client.$pushSchema()

  return {
    dialect,
    client,
    schemaName: dialect.schemaName(url),
    recordedStreams: getRedisKeys(dialect.name).recordedStreams,
    streamName: table => getStreamName(dialect, table, url),
  }
}
