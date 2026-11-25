// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '@/shared/api'
import { createQueryClient } from '@/shared/query'
import {
  DEFAULT_MIRRORCHYAN_CHECK_INTERVAL,
  DEFAULT_RESOURCE_SOURCE_DRAFT,
  ResourceSourceOwner,
  buildResourceSourcePayload,
  normalizeResourceSourceDraft,
  resourceSourceQueryOptions,
  type ResourceSourceOwnerOptions,
} from './resourceSource'
import { settingsKeys } from './queryKeys'

const apiMocks = vi.hoisted(() => ({
  getResourceSource: vi.fn(),
  saveResourceSource: vi.fn(),
}))

vi.mock('../api', () => ({
  getResourceSource: apiMocks.getResourceSource,
  saveResourceSource: apiMocks.saveResourceSource,
}))

type WriteRequest = NonNullable<ResourceSourceOwnerOptions['write']>

const createOwner = (write?: WriteRequest) => (
  new ResourceSourceOwner(write ? { write } : {})
)

const adoptDefaultServer = (owner: ResourceSourceOwner): void => {
  owner.adoptServer({
    config: normalizeResourceSourceDraft(DEFAULT_RESOURCE_SOURCE_DRAFT)!,
    readToken: owner.beginRead(),
  })
}

const serverView = (overrides: Record<string, unknown> = {}) => ({
  autoUpdate: true,
  warnOnUpdateFailure: false,
  source: 'mirrorchyan',
  git: {
    backend: 'git',
    url: 'https://github.com/MaaAssistantArknights/MaaResource.git',
    branch: 'saved-resource-branch',
  },
  mirrorchyan: { cdkKind: 'plain', checkInterval: 1800 },
  ...overrides,
})

describe('resource source normalization', () => {
  it('maps the server view into a draft without echoing credentials', () => {
    const draft = normalizeResourceSourceDraft(serverView({
      mirrorchyan: { cdkKind: 'plain', cdk: 'stored-cdk', checkInterval: 1800 },
    }))

    expect(draft).toEqual({
      autoUpdate: true,
      warnOnUpdateFailure: false,
      source: 'mirrorchyan',
      git: {
        backend: 'git',
      },
      mirrorchyan: { cdk: '', cdkKind: 'plain', clearCdk: false, checkInterval: 1800 },
    })
  })

  it('falls back to defaults for invalid fields and rejects non-objects', () => {
    const draft = normalizeResourceSourceDraft({
      autoUpdate: 'yes',
      source: 'git',
      git: { backend: 'hg', branch: null },
      mirrorchyan: { cdkKind: 'unknown', checkInterval: -1 },
    })

    expect(draft).toMatchObject({
      autoUpdate: false,
      source: 'git',
      git: { backend: 'git' },
      mirrorchyan: { cdkKind: 'none', checkInterval: DEFAULT_MIRRORCHYAN_CHECK_INTERVAL },
    })
    expect(normalizeResourceSourceDraft(null)).toBeNull()
    expect(normalizeResourceSourceDraft({ source: 'ftp' })).toBeNull()
    expect(normalizeResourceSourceDraft({ source: 'git', git: {}, mirrorchyan: {} })).toMatchObject({
      source: 'git',
    })
  })

  it('saves the Git backend as the only Git setting', () => {
    const payload = buildResourceSourcePayload(DEFAULT_RESOURCE_SOURCE_DRAFT)

    expect(payload).toEqual({
      autoUpdate: false,
      warnOnUpdateFailure: false,
      source: 'git',
      git: {
        backend: 'git',
      },
      mirrorchyan: { checkInterval: DEFAULT_MIRRORCHYAN_CHECK_INTERVAL },
    })
  })

  it.each([
    { cdk: ' cdk-value ', clearCdk: false, expected: { cdk: 'cdk-value' } },
    { cdk: '', clearCdk: true, expected: { clearCdk: true } },
  ])('saves MirrorChyan CDK settings', ({ cdk, clearCdk, expected }) => {
    const payload = buildResourceSourcePayload({
      ...DEFAULT_RESOURCE_SOURCE_DRAFT,
      source: 'mirrorchyan',
      git: { backend: 'libgit2' },
      mirrorchyan: { cdk, cdkKind: 'plain', clearCdk, checkInterval: 0 },
    })

    expect(payload.git).toEqual({ backend: 'libgit2' })
    expect(payload.mirrorchyan).toEqual({ checkInterval: 0, ...expected })
  })
})

describe('resource source owner', () => {
  beforeEach(() => {
    apiMocks.getResourceSource.mockReset()
    apiMocks.saveResourceSource.mockReset()
  })

  it('tracks nested edits', () => {
    const owner = createOwner()
    const token = owner.beginRead()
    owner.adoptServer({ config: normalizeResourceSourceDraft(serverView())!, readToken: token })

    expect(owner.update({
      mirrorchyan: { ...owner.getState().draft.mirrorchyan, checkInterval: 60 },
    })).toBe(true)
    expect(owner.getState().dirty).toBe(true)
    expect(owner.getState().draft.mirrorchyan.checkInterval).toBe(60)
  })

  it('saves through the resource source endpoint and keeps nested values intact', async () => {
    apiMocks.saveResourceSource.mockResolvedValue({ success: true })
    const owner = createOwner()
    adoptDefaultServer(owner)
    owner.update({ autoUpdate: true })

    await expect(owner.save()).resolves.toMatchObject({ status: 'saved', superseded: false })
    expect(apiMocks.saveResourceSource).toHaveBeenCalledWith(expect.objectContaining({
      autoUpdate: true,
      source: 'git',
    }))
    expect(owner.getState().dirty).toBe(false)
  })
})

describe('resource source query', () => {
  beforeEach(() => {
    apiMocks.getResourceSource.mockReset()
  })

  it('uses the reserved resource-source key and forwards the signal', async () => {
    apiMocks.getResourceSource.mockResolvedValue({ success: true, data: serverView() })
    const owner = createOwner()
    const options = resourceSourceQueryOptions(owner)

    expect(options.queryKey).toEqual(settingsKeys.query('resource-source'))
    expect(options.queryKey).toEqual(['settings', 'resource-source'])

    const data = await createQueryClient().fetchQuery(options)

    expect(apiMocks.getResourceSource).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(data.config.mirrorchyan.cdkKind).toBe('plain')
  })

  it('turns an unusable payload into a contract failure', async () => {
    apiMocks.getResourceSource.mockResolvedValue({ success: true, data: 'not-a-source' })

    const error = await createQueryClient()
      .fetchQuery(resourceSourceQueryOptions(createOwner()))
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ kind: 'contract', code: 'INVALID_DOMAIN_PAYLOAD' })
  })
})
