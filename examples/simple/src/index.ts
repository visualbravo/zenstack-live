import { schema } from './schema'
import { ZenStackLive } from '@visualbravo/zenstack-live'
import { ZenStackClient } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import Bottleneck from 'bottleneck'

const client = new ZenStackClient(schema, {
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env['POSTGRES_URL'],
    }),
  }),
})

const live = new ZenStackLive({
  client,

  redis: {
    url: process.env['REDIS_URL']!,
  },
})

const userStream = live.stream({
  model: 'User',
  id: 'all-user-changes',
  created: {},
  updated: {},
  deleted: {},
})

setInterval(async () => {
  const user = await client.user.create({
    data: {
      enum: 'USER',
    },
  })

  await client.user.update({
    data: {
      string: 'newhello',
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
}, 5000)

const userStreamLimiter = new Bottleneck({
  minTime: 2000,
  id: userStream.id,
})

;(async () => {
  for await (const event of userStream) {
    await userStreamLimiter.schedule({ id: event.id }, () => {
      console.log(event.type, event.id)

      return Promise.resolve(true)
    })
  }
})()
