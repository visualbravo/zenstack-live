/* eslint-disable */

import type { SchemaDef, GetModels } from '@zenstackhq/schema'
import type { LiveStreamOptions, LiveStreamWhen, RecordEvent } from '.'
import { QueryCompiler } from './query-compiler'
import { z } from 'zod/v4'

export type EventDiscriminatorOptions<
  Schema extends SchemaDef,
  ModelName extends GetModels<Schema>,
> = Omit<LiveStreamOptions<Schema, ModelName>, 'redis' | 'id' | 'clientId'>

export class EventDiscriminator<Schema extends SchemaDef, ModelName extends GetModels<Schema>> {
  private readonly when: LiveStreamWhen<Schema, ModelName>
  private readonly queryCompiler: QueryCompiler<Schema, ModelName>
  private readonly createdSchema?: z.ZodSchema
  private readonly updatedBeforeSchema?: z.ZodSchema
  private readonly updatedAfterSchema?: z.ZodSchema
  private readonly deletedSchema?: z.ZodSchema

  constructor(streamOptions: EventDiscriminatorOptions<Schema, ModelName>) {
    const { when = {} } = streamOptions

    // Without any subscriptions, all events are listened for.
    this.when =
      when.created || when.updated || when.deleted
        ? when
        : { created: {}, updated: {}, deleted: {} }

    this.queryCompiler = new QueryCompiler({
      schema: streamOptions.client.$schema,
      modelName: streamOptions.model,
    })

    if (this.when.created) {
      this.createdSchema = this.queryCompiler.compile(this.when.created)
    }

    if (this.when.updated?.before) {
      this.updatedBeforeSchema = this.queryCompiler.compile(this.when.updated.before)
    }

    if (this.when.updated?.after) {
      this.updatedAfterSchema = this.queryCompiler.compile(this.when.updated.after)
    }

    if (this.when.deleted) {
      this.deletedSchema = this.queryCompiler.compile(this.when.deleted)
    }
  }

  eventMatchesWhere(event: RecordEvent<Schema, ModelName>) {
    if (!this.when[event.type]) {
      return false
    }

    if (event.type === 'created' && this.createdSchema) {
      return this.createdSchema.safeParse(event.created).success
    } else if (event.type === 'deleted' && this.deletedSchema) {
      return this.deletedSchema.safeParse(event.deleted).success
    } else if (event.type === 'updated') {
      if (this.updatedBeforeSchema && this.updatedAfterSchema) {
        return (
          this.updatedBeforeSchema.safeParse(event.updated.before).success &&
          this.updatedAfterSchema.safeParse(event.updated.after).success
        )
      } else if (this.updatedBeforeSchema && !this.updatedAfterSchema) {
        return (
          this.updatedBeforeSchema.safeParse(event.updated.before).success &&
          !this.updatedBeforeSchema.safeParse(event.updated.after).success
        )
      } else if (!this.updatedBeforeSchema && this.updatedAfterSchema) {
        return (
          this.updatedAfterSchema.safeParse(event.updated.after).success &&
          !this.updatedAfterSchema.safeParse(event.updated.before).success
        )
      } else if (!this.updatedBeforeSchema && !this.updatedAfterSchema) {
        return true
      }
    }

    throw new Error(
      'All possible where clause combinations exhausted. This error should never occur.',
    )
  }
}
