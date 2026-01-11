import { env } from '@newproject/env/server'
import { ZenStackClient } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { schema } from './.generated/schema'
import { PolicyPlugin } from '@zenstackhq/plugin-policy'

export const zenstack = new ZenStackClient(schema, {
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: env.POSTGRES_URL,
    }),
  }),
}).$use(new PolicyPlugin())
