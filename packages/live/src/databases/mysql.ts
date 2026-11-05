import type { SchemaDef } from '@zenstackhq/schema'
import type { ClientContract } from '@zenstackhq/orm'
import type { CapturedTable, LiveDatabase } from './database'
import type { DebeziumSource } from '../internal'

// Debezium reads MySQL's binlog, which holds every table's changes, and captures the database named
// in its `DATABASE_URL`. Nothing has to be published, and nothing can be released. The binlog is
// assumed to hold full rows, since that's set server-wide.
export class MysqlDatabase<Schema extends SchemaDef> implements LiveDatabase {
  public readonly dialect = 'mysql'
  private readonly client: ClientContract<Schema>
  private database?: Promise<string>

  public constructor(client: ClientContract<Schema>) {
    this.client = client
  }

  // ZenStack doesn't qualify tables on MySQL, so every model is in the connection's database, and
  // Debezium names streams `<prefix>.<database>.<table>`.
  public async getSchemaName(_model: string) {
    this.database ??= this.queryDatabase().catch(error => {
      this.database = undefined
      throw error
    })

    return await this.database
  }

  // Every table is already captured.
  public async captureTable(_schemaName: string, _tableName: string) {}

  // `prune` never releases a table that's `allTables`, so these are never called for MySQL tables.
  public async releaseTable(_table: CapturedTable) {}

  public async restoreTable(_table: CapturedTable) {}

  public async getCapturedTables() {
    const tables = await this.client.$queryRawUnsafe<{ schemaName: string; tableName: string }[]>(`
      SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
    `)

    return tables.map(({ schemaName, tableName }) => ({
      schemaName,
      tableName,
      allTables: true,
      replicaIdentityFull: true,
    }))
  }

  // Every event of a transaction shares its GTID, which needs `gtid_mode=ON`.
  public getTransactionId(source: DebeziumSource) {
    return String(source.gtid)
  }

  private async queryDatabase() {
    const [row] = await this.client.$queryRawUnsafe<{ name: string }[]>('SELECT DATABASE() AS name')

    return row!.name
  }
}
