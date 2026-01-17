// oxlint-disable init-declarations
// oxlint-disable no-unused-vars
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { schema } from './schemas/basic'
import { ZenStackLive, beforeAfter } from '../src'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'

describe('live', () => {
  let client: ClientContract<typeof schema>
  let live: ZenStackLive<typeof schema>

  beforeEach(async () => {
    client = new ZenStackClient(schema, {
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: process.env['POSTGRES_URL'],
        }),
      }),
    })

    await Promise.all([
      client.$queryRawUnsafe('ALTER TABLE "User" REPLICA IDENTITY FULL'),
      client.$queryRawUnsafe('ALTER TABLE "Post" REPLICA IDENTITY FULL'),
      client.$queryRawUnsafe('ALTER TABLE "Profile" REPLICA IDENTITY FULL'),
    ])

    live = new ZenStackLive({
      schema,
      id: 'zenstack',

      redis: {
        url: process.env['REDIS_URL'] as string,
      },
    })
  })

  afterEach(async () => {
    await Promise.all([client.$disconnect(), live.disconnect()])
  })

  test('streaming', async () => {
    await client.user.deleteMany({
      where: {
        id: '1',
      },
    })

    await client.user.create({
      data: {
        id: '1',
        string: 'string',
        stringArray: ['stringArray'],
        boolean: true,
        booleanArray: [true],
        dateTime: new Date(),
        enum: 'USER',
        bigInt: BigInt(1),
        bigIntArray: [BigInt(1)],
        int: 1,
        intArray: [1],
        float: 1,
        floatArray: [1],
        json: {},
      },
    })

    const stream = live.stream({
      model: 'User',
      id: 'all-user-changes',
      created: {},
    })

    for await (const event of stream) {
      const { before, after } = beforeAfter(event)

      console.log(event)
    }
  })
})
