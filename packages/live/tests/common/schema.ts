/* eslint-disable */

// Written by hand for tests that run on every dialect, so it leaves out what only some providers
// support, like arrays of scalars. Names are prefixed to stay apart from the Postgres test schemas.

import {
  type SchemaDef,
  type AttributeApplication,
  type FieldDefault,
  ExpressionUtils,
} from '@zenstackhq/schema'

const map = (name: string) =>
  [
    { name: '@map', args: [{ name: 'name', value: ExpressionUtils.literal(name) }] },
  ] as readonly AttributeApplication[]

const modelMap = (name: string) =>
  [
    { name: '@@map', args: [{ name: 'name', value: ExpressionUtils.literal(name) }] },
  ] as readonly AttributeApplication[]

const cuid = {
  name: 'id',
  type: 'String',
  id: true,
  attributes: [
    { name: '@id' },
    { name: '@default', args: [{ name: 'value', value: ExpressionUtils.call('cuid') }] },
  ] as readonly AttributeApplication[],
  default: ExpressionUtils.call('cuid') as FieldDefault,
} as const

export class SchemaType implements SchemaDef {
  provider = {
    type: 'postgresql',
  } as const
  models = {
    User: {
      name: 'User',
      fields: {
        id: cuid,
        string: { name: 'string', type: 'String', optional: true },
        boolean: { name: 'boolean', type: 'Boolean', optional: true },
        int: { name: 'int', type: 'Int', optional: true },
        float: { name: 'float', type: 'Float', optional: true },
        dateTime: { name: 'dateTime', type: 'DateTime', optional: true },
        bigInt: { name: 'bigInt', type: 'BigInt', optional: true },
        decimal: { name: 'decimal', type: 'Decimal', optional: true },
        bytes: { name: 'bytes', type: 'Bytes', optional: true },
        json: { name: 'json', type: 'Json', optional: true },
        enum: { name: 'enum', type: 'Plan' },
        displayName: {
          name: 'displayName',
          type: 'String',
          optional: true,
          attributes: map('display_name'),
        },
      },
      attributes: modelMap('common_users'),
      idFields: ['id'],
      uniqueFields: {
        id: { type: 'String' },
      },
    },
    Contact: {
      name: 'Contact',
      fields: {
        id: cuid,
        createdAt: {
          name: 'createdAt',
          type: 'DateTime',
          attributes: [
            { name: '@default', args: [{ name: 'value', value: ExpressionUtils.call('now') }] },
          ] as readonly AttributeApplication[],
          default: ExpressionUtils.call('now') as FieldDefault,
        },
        email: { name: 'email', type: 'Email' },
        age: { name: 'age', type: 'Age', optional: true },
        balance: { name: 'balance', type: 'Balance', optional: true },
        visits: { name: 'visits', type: 'Visits', optional: true },
        lastSeen: { name: 'lastSeen', type: 'LastSeen', optional: true },
        profile: {
          name: 'profile',
          type: 'Profile',
          optional: true,
          attributes: [{ name: '@json' }] as readonly AttributeApplication[],
        },
        metadata: { name: 'metadata', type: 'Json', optional: true },
        avatar: { name: 'avatar', type: 'Bytes', optional: true },
      },
      attributes: modelMap('common_contacts'),
      idFields: ['id'],
      uniqueFields: {
        id: { type: 'String' },
      },
    },
  } as const
  typeDefs = {
    Email: {
      name: 'Email',
      base: 'String',
      fields: {
        this: {
          name: 'this',
          type: 'String',
          attributes: [{ name: '@email' }] as readonly AttributeApplication[],
        },
      },
    },
    Age: { name: 'Age', base: 'Int', fields: {} },
    Balance: { name: 'Balance', base: 'Decimal', fields: {} },
    Visits: { name: 'Visits', base: 'BigInt', fields: {} },
    LastSeen: { name: 'LastSeen', base: 'DateTime', fields: {} },
    Geo: {
      name: 'Geo',
      fields: {
        lat: { name: 'lat', type: 'Float' },
        lng: { name: 'lng', type: 'Float' },
      },
    },
    Address: {
      name: 'Address',
      fields: {
        city: { name: 'city', type: 'String' },
        country: { name: 'country', type: 'String', optional: true },
        geo: { name: 'geo', type: 'Geo', optional: true },
        tags: { name: 'tags', type: 'String', array: true },
        plan: { name: 'plan', type: 'Plan', optional: true },
        movedAt: { name: 'movedAt', type: 'DateTime', optional: true },
      },
    },
    Profile: {
      name: 'Profile',
      fields: {
        name: { name: 'name', type: 'String' },
        nickname: { name: 'nickname', type: 'Email', optional: true },
        age: { name: 'age', type: 'Age', optional: true },
        joinedAt: { name: 'joinedAt', type: 'DateTime', optional: true },
        balance: { name: 'balance', type: 'Decimal', optional: true },
        address: { name: 'address', type: 'Address', optional: true },
        addresses: { name: 'addresses', type: 'Address', array: true },
      },
    },
  } as const
  enums = {
    Plan: {
      name: 'Plan',
      values: {
        FREE: 'FREE',
        PRO: 'PRO',
      },
      fields: {
        FREE: { name: 'FREE', attributes: map('free') },
        PRO: { name: 'PRO' },
      },
    },
  } as const
  plugins = {}
}
export const schema = new SchemaType()
