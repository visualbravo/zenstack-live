import { Client } from 'pg'

// A replication slot looks publications up as of the WAL it's reading, so one that's been dropped
// stops the slot for good, even once it's recreated. Publications and slots belong to a database, so
// tests that drop the publication run in their own, where they can't reach Debezium's slot.
export async function createIsolatedDatabase(name: string) {
  const admin = new Client({
    connectionString: process.env['POSTGRES_URL'],
  })

  await admin.connect()

  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`)
    await admin.query(`CREATE DATABASE ${name}`)
  } finally {
    await admin.end()
  }

  const url = new URL(process.env['POSTGRES_URL']!)

  url.pathname = `/${name}`

  return url.toString()
}
