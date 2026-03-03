// oxlint-disable no-promise-executor-return
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { schema } from './schemas/basic'
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { ZenStackLive, type DatabaseEventType } from '../src'
import { Redis } from 'ioredis'

let client: ClientContract<typeof schema>
let live: ZenStackLive<typeof schema>
let redis: Redis

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
      url: process.env['REDIS_URL'] as string,
    },
  })

  redis = new Redis(process.env['REDIS_URL']!)

  // await client.$queryRawUnsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  // await client.$pushSchema()
  await Promise.all([
    client.$queryRawUnsafe('ALTER TABLE "User" REPLICA IDENTITY FULL'),
    client.$queryRawUnsafe('ALTER TABLE "Post" REPLICA IDENTITY FULL'),
    // client.$queryRawUnsafe('ALTER TABLE "Profile" REPLICA IDENTITY FULL'),
  ])
})

beforeEach(async () => {
  await redis.flushall()
})

afterAll(async () => {
  await client.$disconnect()
})

describe('ZenStackLive', () => {
  describe('consume', () => {
    test('new', async () => {
      const userStream = live.stream({
        model: 'User',
        id: 'test-consume-new',
        consume: 'new',
        created: {},
        updated: {},
        deleted: {},
      })

      const user = await client.user.create({
        data: {
          enum: 'USER',
        },
      })

      await client.user.update({
        data: {
          enum: 'ADMIN',
        },

        where: {
          id: user.id,
        },
      })

      await client.user.delete({
        where: {
          id: user.id,
        },
      })

      const iterations: DatabaseEventType[] = []

      try {
        for await (const event of userStream) {
          iterations.push(event.type)

          if (event.type === 'deleted') {
            throw new Error('Test')
          }
        }
      } catch {
        // Ensure no new events arrive within 2 seconds.
        const it = userStream[Symbol.asyncIterator]() as AsyncIterator<any>

        const result = await Promise.race<any>([
          it.next(),
          // oxlint-disable-next-line no-promise-executor-return
          new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 2000)),
        ])

        if (!result || result.timeout) {
          // no new events received within timeout -> test passes
        } else {
          // oxlint-disable-next-line no-lonely-if
          if (!result.done) {
            iterations.push(result.value.type)
          }
        }
      }

      expect(iterations).toHaveLength(3)
    }, 10000)

    test('errored', async () => {
      const userStream = live.stream({
        model: 'User',
        id: 'test-consume-errored',
        consume: 'errored',
        timeout: 2000,
        created: {},
        updated: {},
        deleted: {},
      })

      const user = await client.user.create({
        data: {
          enum: 'USER',
        },
      })

      await client.user.update({
        data: {
          enum: 'ADMIN',
        },

        where: {
          id: user.id,
        },
      })

      await client.user.delete({
        where: {
          id: user.id,
        },
      })

      const iterations: DatabaseEventType[] = []

      // Ensure no new events arrive within 2 seconds.
      const it = userStream[Symbol.asyncIterator]() as AsyncIterator<any>

      const result = await Promise.race<any>([
        it.next(),
        new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 2000)),
      ])

      if (!result || result.timeout) {
        const user = await client.user.create({
          data: {
            enum: 'USER',
          },
        })

        await client.user.update({
          data: {
            enum: 'ADMIN',
          },

          where: {
            id: user.id,
          },
        })

        await client.user.delete({
          where: {
            id: user.id,
          },
        })

        const innerUserStream = live.stream({
          model: 'User',
          id: 'test-consume-errored',
          consume: 'new',
          created: {},
          updated: {},
          deleted: {},
        })

        try {
          for await (const event of innerUserStream) {
            iterations.push(event.type)

            if (event.type === 'deleted') {
              throw new Error()
            }
          }
        } catch {
          await new Promise(resolve => setTimeout(resolve, 2000))

          for await (const event of userStream) {
            iterations.push(event.type)

            if (event.type === 'deleted') {
              break
            }
          }

          expect(iterations).toHaveLength(4)
        }
      } else {
        // oxlint-disable-next-line no-lonely-if
        if (!result.done) {
          iterations.push(result.value.type)
        }
      }
    }, 10000)

    test('all', async () => {
      const userStream = live.stream({
        model: 'User',
        id: 'test-consume-all',
        consume: 'all',
        created: {},
        updated: {},
        deleted: {},
      })

      const user = await client.user.create({
        data: {
          enum: 'USER',
        },
      })

      await client.user.update({
        data: {
          enum: 'ADMIN',
        },

        where: {
          id: user.id,
        },
      })

      await client.user.update({
        data: {
          enum: 'USER',
        },

        where: {
          id: user.id,
        },
      })

      await client.user.delete({
        where: {
          id: user.id,
        },
      })

      const iterations: DatabaseEventType[] = []

      try {
        for await (const event of userStream) {
          iterations.push(event.type)

          if (iterations.length === 3) {
            throw new Error('Test')
          }
        }
      } catch {
        for await (const event of userStream) {
          iterations.push(event.type)

          if (event.type === 'deleted') {
            break
          }
        }
      }

      expect(iterations).toHaveLength(5)
    }, 10000)
  })

  test('limiter', async () => {
    const userStream = live.stream({
      model: 'User',
      id: 'test-limiter',
      consume: 'all',

      limiter: {
        minTime: 1000,
      },

      created: {},
      updated: {},
      deleted: {},
    })

    const user = await client.user.create({
      data: {
        enum: 'USER',
      },
    })

    await client.user.update({
      data: {
        enum: 'ADMIN',
      },

      where: {
        id: user.id,
      },
    })

    await client.user.delete({
      where: {
        id: user.id,
      },
    })

    const iterations: number[] = []

    for await (const event of userStream) {
      iterations.push(Date.now())

      if (event.type === 'deleted') {
        break
      }
    }

    for (let i = 1; i < iterations.length; i++) {
      const delta = iterations[i]! - iterations[i - 1]!
      expect(delta).closeTo(1000, 100)
    }

    expect(iterations).toHaveLength(3)
  }, 10000)
})
