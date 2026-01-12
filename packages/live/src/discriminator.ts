/* eslint-disable */

import type { SchemaDef, GetModels } from '@zenstackhq/schema'
import type { WhereInput, ClientContract, SimplifiedPlainResult } from '@zenstackhq/orm'
import { ZenStackClient, InputValidator } from '@zenstackhq/orm'
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite'
import { parse } from 'lossless-json'
import type { LiveStreamOptions, ZenStackLiveEvent } from '.'

export class EventDiscriminator<
  Schema extends SchemaDef,
  ModelName extends GetModels<Schema>,
>{
  private readonly streamOptions: LiveStreamOptions<Schema, ModelName>
  
  constructor(streamOptions: LiveStreamOptions<Schema, ModelName>) {
    this.streamOptions = streamOptions
  }

  eventMatchesWhere(event: ZenStackLiveEvent) {
    return true
  }
}