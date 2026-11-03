import type { SchemaDef } from '@zenstackhq/schema'
import type { ClientContract } from '@zenstackhq/orm'
import { PostgresDatabase } from './postgres'

// A table that Debezium is capturing changes from.
export type CapturedTable = {
  schemaName: string
  tableName: string

  // The table is captured because every table is, so it can't be released on its own.
  allTables: boolean
  replicaIdentityFull: boolean
}

// Everything that LIVE needs from the database itself. Each provider that ZenStack supports gets
// its own implementation, because how changes are captured differs between them.
export interface LiveDatabase {
  // The schema that a model's table is in, which Debezium names its stream after.
  getSchemaName(model: string): string

  // Starts capturing a table's changes, along with the full previous row of updates and deletes.
  captureTable(schemaName: string, tableName: string): Promise<void>

  // Stops capturing a table's changes.
  releaseTable(table: CapturedTable): Promise<void>

  // Undoes `releaseTable`, for when a stream comes back while its table is being released.
  restoreTable(table: CapturedTable): Promise<void>

  getCapturedTables(): Promise<CapturedTable[]>
}

export function createLiveDatabase<Schema extends SchemaDef>(
  client: ClientContract<Schema>,
): LiveDatabase {
  const provider = client.$schema.provider.type

  switch (provider) {
    case 'postgresql':
      return new PostgresDatabase(client)
    default:
      throw new Error(`ZenStack LIVE doesn't support the "${provider}" provider yet`)
  }
}
