import type { SchemaDef } from '@zenstackhq/schema'
import type { ClientContract } from '@zenstackhq/orm'
import type { DebeziumSource } from '../internal'
import { MysqlDatabase } from './mysql'
import { PostgresDatabase } from './postgres'

// A table that Debezium is capturing changes from.
export type CapturedTable = {
  schemaName: string
  tableName: string

  // The table is captured because every table is, so it can't be released on its own.
  allTables: boolean

  // Whether updates and deletes carry the full previous row. On Postgres this is the table's
  // `REPLICA IDENTITY`. On MySQL it's always true, since `binlog_row_image=FULL` is assumed.
  replicaIdentityFull: boolean
}

// Each dialect gets its own Redis keys, so that one Redis can be shared by Debezium instances
// capturing different kinds of database. These have to match `zebezium/entrypoint.sh`.
export type LiveDialect = 'postgres' | 'mysql'

export type LiveRedisKeys = {
  // Debezium's `topic.prefix`, which every stream is named after: `<prefix>.<schema>.<table>`.
  streamPrefix: string
  recordedStreams: string
}

export function getRedisKeys(dialect: LiveDialect): LiveRedisKeys {
  return {
    streamPrefix: `zenstack.${dialect}.table.`,
    recordedStreams: `zenstack.${dialect}.metadata.streams`,
  }
}

// Everything that LIVE needs from the database itself. Each provider that ZenStack supports gets
// its own implementation, because how changes are captured differs between them.
export interface LiveDatabase {
  // Decides which Redis keys are used, see `getRedisKeys`.
  readonly dialect: LiveDialect

  // The schema that a model's table is in, which Debezium names its stream after. On MySQL this is
  // the database, which is only known once the connection is asked for it.
  getSchemaName(model: string): Promise<string>

  // Starts capturing a table's changes, along with the full previous row of updates and deletes.
  captureTable(schemaName: string, tableName: string): Promise<void>

  // Stops capturing a table's changes.
  releaseTable(table: CapturedTable): Promise<void>

  // Undoes `releaseTable`, for when a stream comes back while its table is being released.
  restoreTable(table: CapturedTable): Promise<void>

  getCapturedTables(): Promise<CapturedTable[]>

  // Identifies the transaction that an event came from. Events from one transaction share it.
  getTransactionId(source: DebeziumSource): string
}

export function createLiveDatabase<Schema extends SchemaDef>(
  client: ClientContract<Schema>,
): LiveDatabase {
  const provider = client.$schema.provider.type

  switch (provider) {
    case 'postgresql':
      return new PostgresDatabase(client)
    case 'mysql':
      return new MysqlDatabase(client)
    default:
      throw new Error(`ZenStack LIVE doesn't support the "${provider}" provider yet`)
  }
}
