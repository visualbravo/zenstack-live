import type { Redis } from 'ioredis'
import { getRedisKeys, type LiveDialect } from '../../src'

// Removes what LIVE keeps for one dialect. `FLUSHALL` would also remove what the other dialect's
// Debezium keeps, like its schema history, which MySQL's can't restart without.
export async function clearRedis(redis: Redis, dialect: LiveDialect) {
  const { streamPrefix, recordedStreams } = getRedisKeys(dialect)
  const keys = [recordedStreams]
  let cursor = '0'

  do {
    const [nextCursor, found] = await redis.scan(cursor, 'MATCH', `${streamPrefix}*`, 'COUNT', 1000)

    cursor = nextCursor
    keys.push(...found)
  } while (cursor !== '0')

  await redis.del(...keys)
}
