/* eslint-disable */

import type { SchemaDef, GetModels } from '@zenstackhq/schema'
import type { WhereInput, ClientContract, SimplifiedPlainResult } from '@zenstackhq/orm'
import { ZenStackClient, InputValidator } from '@zenstackhq/orm'
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite'
import { parse } from 'lossless-json'
import type { LiveStreamOptions, ZenStackLiveEvent } from '.'
import { QueryCompiler } from './compiler'
import { z } from 'zod/v4'

export class EventDiscriminator<Schema extends SchemaDef, ModelName extends GetModels<Schema>> {
  private readonly streamOptions: LiveStreamOptions<Schema, ModelName>
  private readonly queryCompiler: QueryCompiler<Schema, ModelName>
  private readonly createdSchema?: z.ZodSchema
  private readonly updatedSchema?: z.ZodSchema
  private readonly deletedSchema?: z.ZodSchema

  constructor(streamOptions: LiveStreamOptions<Schema, ModelName>) {
    this.streamOptions = streamOptions

    this.queryCompiler = new QueryCompiler({
      schema: streamOptions.schema,
      modelName: streamOptions.model,
    })

    if (this.streamOptions.created) {
      this.createdSchema = this.queryCompiler.compile(this.streamOptions.created)
    }

    if (this.streamOptions.updated) {
      this.updatedSchema = this.queryCompiler.compile(this.streamOptions.created)
    }

    if (this.streamOptions.deleted) {
      this.deletedSchema = this.queryCompiler.compile(this.streamOptions.deleted)
    }
  }

  eventMatchesWhere(event: ZenStackLiveEvent) {
    if (!this.streamOptions[event.type]) {
      return false
    }

    if (event.type === 'created' && this.createdSchema) {
      const { success } = this.createdSchema.safeParse(event.after)

      return success
    } else if (event.type === 'deleted' && this.deletedSchema) {
      const { success } = this.deletedSchema.safeParse(event.before)

      return success
    }
  }
}
