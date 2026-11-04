import type { SchemaDef } from '@zenstackhq/schema'
import type { ClientContract } from '@zenstackhq/orm'
import type { CapturedTable, LiveDatabase } from './database'
import type { DebeziumSource } from '../internal'

type BinlogSettings = {
  logBin: number | string | null
  binlogFormat: string | null
  binlogRowImage: string | null
}

// Debezium reads MySQL's binlog, which holds every table's changes, and captures the database named
// in its `DATABASE_URL`. Nothing has to be published, and nothing can be released. What LIVE can
// check is that the binlog holds what it needs, which is set server-wide.
export class MySqlDatabase<Schema extends SchemaDef> implements LiveDatabase {
  public readonly dialect = 'mysql'
  private readonly client: ClientContract<Schema>
  private database?: Promise<string>
  private binlogChecked?: Promise<void>

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

  // Without a full row image, `before` only holds the primary key and would quietly fail filters.
  public async captureTable(_schemaName: string, _tableName: string) {
    this.binlogChecked ??= this.checkBinlog().catch(error => {
      this.binlogChecked = undefined
      throw error
    })

    await this.binlogChecked
  }

  // `prune` never releases a table that's `allTables`, so these are never called for MySQL tables.
  public async releaseTable(_table: CapturedTable) {}

  public async restoreTable(_table: CapturedTable) {}

  public async getCapturedTables() {
    const [tables, settings] = await Promise.all([
      this.client.$queryRawUnsafe<{ schemaName: string; tableName: string }[]>(`
        SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      `),
      this.getBinlogSettings(),
    ])

    const replicaIdentityFull = settings.binlogRowImage?.toUpperCase() === 'FULL'

    return tables.map(({ schemaName, tableName }) => ({
      schemaName,
      tableName,
      allTables: true,
      replicaIdentityFull,
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

  private async getBinlogSettings() {
    const [row] = await this.client.$queryRawUnsafe<BinlogSettings[]>(`
      SELECT
        @@GLOBAL.log_bin AS logBin,
        @@GLOBAL.binlog_format AS binlogFormat,
        @@GLOBAL.binlog_row_image AS binlogRowImage
    `)

    return row ?? { logBin: null, binlogFormat: null, binlogRowImage: null }
  }

  private async checkBinlog() {
    const { logBin, binlogFormat, binlogRowImage } = await this.getBinlogSettings()
    const problems: string[] = []

    if (!['1', 'ON'].includes(String(logBin).toUpperCase())) {
      problems.push('log_bin has to be enabled')
    }

    if (binlogFormat?.toUpperCase() !== 'ROW') {
      problems.push(`binlog_format has to be ROW, not ${binlogFormat}`)
    }

    if (binlogRowImage?.toUpperCase() !== 'FULL') {
      problems.push(`binlog_row_image has to be FULL, not ${binlogRowImage}`)
    }

    if (problems.length > 0) {
      throw new Error(`ZenStack LIVE can't capture changes from MySQL: ${problems.join(', ')}`)
    }
  }
}
