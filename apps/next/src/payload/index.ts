import config from '@payload-config'
import { getPayload as getPayloadInternal } from 'payload'

export function getPayload() {
  return getPayloadInternal({
    config,
  })
}
