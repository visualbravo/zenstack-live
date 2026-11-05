import type { SchemaDef } from '@zenstackhq/schema'
import type { ClientContract } from '@zenstackhq/orm'
import type { CapturedTable, LiveDatabase } from './database'
import { getAttribute, type DebeziumSource } from '../internal'

const PUBLICATION = 'zenstack_live'

// Blocks that change the publication check it first, so they have to run one at a time. Otherwise
// two of them can both find the publication missing, and the second fails to create it.
const LOCK_PUBLICATION = `PERFORM pg_advisory_xact_lock(hashtext(${quoteLiteral(PUBLICATION)}));`

// Debezium reads changes through a logical replication slot, which only sees the tables in its
// publication. `REPLICA IDENTITY FULL` is what puts the whole previous row into updates and deletes.
export class PostgresDatabase<Schema extends SchemaDef> implements LiveDatabase {
  public readonly dialect = 'postgresql'
  private readonly client: ClientContract<Schema>

  public constructor(client: ClientContract<Schema>) {
    this.client = client
  }

  // This follows how ZenStack resolves a model, because Debezium names streams after the real table.
  public async getSchemaName(model: string) {
    return (
      getAttribute(this.client.$schema.models[model]!, '@@schema', 'map') ??
      this.client.$schema.provider.defaultSchema ??
      'public'
    )
  }

  // This is one block so that `ALTER TABLE` holds its lock until the table is published. Otherwise a
  // write in between could be captured without its full previous row.
  public async captureTable(schemaName: string, tableName: string) {
    const table = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`
    const publication = quoteIdentifier(PUBLICATION)

    await this.client.$queryRawUnsafe(`
      DO $do$
      DECLARE
        all_tables boolean;
      BEGIN
        ${LOCK_PUBLICATION}

        ALTER TABLE ${table} REPLICA IDENTITY FULL;

        SELECT puballtables INTO all_tables
        FROM pg_publication
        WHERE pubname = ${quoteLiteral(PUBLICATION)};

        IF NOT FOUND THEN
          CREATE PUBLICATION ${publication} FOR TABLE ${table};
        ELSIF NOT all_tables AND NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = ${quoteLiteral(PUBLICATION)}
            AND schemaname = ${quoteLiteral(schemaName)}
            AND tablename = ${quoteLiteral(tableName)}
        ) THEN
          ALTER PUBLICATION ${publication} ADD TABLE ${table};
        END IF;
      END
      $do$
    `)
  }

  public async releaseTable(table: CapturedTable) {
    await this.updatePublication(table, 'DROP')
  }

  public async restoreTable(table: CapturedTable) {
    await this.updatePublication(table, 'ADD')
  }

  public async getCapturedTables() {
    return await this.client.$queryRawUnsafe<CapturedTable[]>(`
      SELECT
        t.schemaname AS "schemaName",
        t.tablename AS "tableName",
        p.puballtables AS "allTables",
        c.relreplident = 'f' AS "replicaIdentityFull"
      FROM pg_publication_tables t
      JOIN pg_publication p ON p.pubname = t.pubname
      JOIN pg_namespace n ON n.nspname = t.schemaname
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.tablename
      WHERE t.pubname = ${quoteLiteral(PUBLICATION)}
    `)
  }

  public getTransactionId(source: DebeziumSource) {
    return String(source.txId)
  }

  private async updatePublication(table: CapturedTable, action: 'ADD' | 'DROP') {
    await this.client.$queryRawUnsafe(`
      DO $do$
      BEGIN
        ${LOCK_PUBLICATION}

        IF ${action === 'ADD' ? 'NOT' : ''} EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = ${quoteLiteral(PUBLICATION)}
            AND schemaname = ${quoteLiteral(table.schemaName)}
            AND tablename = ${quoteLiteral(table.tableName)}
        ) THEN
          ALTER PUBLICATION ${quoteIdentifier(PUBLICATION)}
          ${action} TABLE ${quoteIdentifier(table.schemaName)}.${quoteIdentifier(table.tableName)};
        END IF;
      END
      $do$
    `)
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}
