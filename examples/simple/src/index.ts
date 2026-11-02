import { schema } from './schema'
import { ZenStackLive } from '@visualbravo/zenstack-live'
import { ZenStackClient } from '@zenstackhq/orm'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const client = new ZenStackClient(schema, {
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env['POSTGRES_URL'],
    }),
  }),
})

const live = new ZenStackLive({
  client,
  retention: 500000000000,

  redis: {
    url: process.env['REDIS_URL']!,
  },
})

const userStream = live.stream({
  model: 'User',
  slug: 'all-user-changes',
})

// setInterval(async () => {
//   const user = await client.user.create({
//     data: {
//       enum: 'USER',
//     },
//   })

//   await client.user.update({
//     data: {
//       string: 'newhello',
//     },

//     where: {
//       id: user.id,
//     },
//   })

//   await client.user.delete({
//     where: {
//       id: user.id,
//     },
//   })
// }, 100)

// const userStreamLimiter = new Bottleneck({
//   id: userStream.id,
//   minTime: 0,
// })

// userStreamLimiter.on('failed', (error, job) => {
//   if (job.retryCount < 3) {
//     return 1000
//   }
// })

;(async () => {
  for await (const event of userStream) {
    console.log(event.type, event.id)
  }
})()

console.log('Waiting for `User` changes')

// ;(async () => {
//   console.log(await live.prune({
//     olderThan: 6000,
//   }))
// })()
