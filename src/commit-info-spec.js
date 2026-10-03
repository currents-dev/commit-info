'use strict'

/* eslint-env mocha */
const { commitInfo } = require('.')
const { stubSpawnOnce } = require('stub-spawn-once')
const snapshot = require('snap-shot-it')
const { gitCommands } = require('./git-api')
const la = require('lazy-ass')
const is = require('check-more-types')
const mockedEnv = require('mocked-env')

describe('getBranch', () => {
  const { getBranch } = require('.')

  it('is a function', () => {
    la(is.fn(getBranch))
  })

  it('returns null for empty output', () => {
    stubSpawnOnce(gitCommands.branch, 0, '', '')
    return getBranch().then(branch => {
      la(
        branch === null,
        'empty branch should be null, but it was',
        typeof branch
      )
    })
  })

  it('returns null on git error', () => {
    stubSpawnOnce(gitCommands.branch, 1, '', 'something wrong')
    return getBranch().then(branch => {
      la(
        branch === null,
        'empty branch should be null, but it was',
        typeof branch
      )
    })
  })

  it('returns null on git HEAD', () => {
    stubSpawnOnce(gitCommands.branch, 0, 'HEAD', '')
    return getBranch().then(branch => {
      la(
        branch === null,
        'empty branch should be null, but it was',
        typeof branch
      )
    })
  })
})

describe('commit-info', () => {
  describe('no environment variables', () => {
    let restoreEnvironment

    beforeEach(() => {
      restoreEnvironment = mockedEnv({}, { clear: true })
    })

    afterEach(() => {
      restoreEnvironment()
    })

    it('has certain api', () => {
      const api = require('.')
      snapshot(Object.keys(api))
    })

    it('returns information', () => {
      stubSpawnOnce(gitCommands.branch, 0, 'test-branch', '')
      stubSpawnOnce(gitCommands.message, 0, 'important commit', '')
      stubSpawnOnce(gitCommands.email, 0, 'me@foo.com', '')
      stubSpawnOnce(gitCommands.author, 0, 'John Doe', '')
      stubSpawnOnce(gitCommands.sha, 0, 'abc123', '')
      stubSpawnOnce(gitCommands.timestamp, 0, '123', '')
      stubSpawnOnce(gitCommands.remoteOriginUrl, 0, 'git@github.com/repo', '')
      return commitInfo().then(snapshot)
    })

    it('returns nulls for missing fields', () => {
      stubSpawnOnce(gitCommands.branch, 0, 'test-branch', '')
      stubSpawnOnce(gitCommands.message, 1, '', 'no message')
      stubSpawnOnce(gitCommands.email, 0, 'me@foo.com', '')
      stubSpawnOnce(gitCommands.author, 1, '', 'missing author')
      stubSpawnOnce(gitCommands.sha, 0, 'abc123', '')
      stubSpawnOnce(gitCommands.remoteOriginUrl, 1, '', 'no remote origin')
      stubSpawnOnce(gitCommands.timestamp, 0, '123', '')
      return commitInfo()
        .tap(info => {
          la(info.message === null, 'message should be null', info)
          la(info.author === null, 'author should be null', info)
          la(info.remote === null, 'remoteOriginUrl should be null', info)
        })
        .then(snapshot)
    })

    it('has getRemoteOrigin method', () => {
      const { getRemoteOrigin } = require('.')
      la(is.fn(getRemoteOrigin))
    })
  })

  describe('combination with environment variables', () => {
    let restoreEnvironment

    beforeEach(() => {
      restoreEnvironment = mockedEnv(
        {
          COMMIT_INFO_MESSAGE: 'some git message',
          COMMIT_INFO_EMAIL: 'user@company.com'
        },
        { clear: true }
      )
    })

    afterEach(() => {
      restoreEnvironment()
    })

    it('has certain api', () => {
      const api = require('.')
      snapshot(Object.keys(api))
    })

    it('returns information', () => {
      stubSpawnOnce(gitCommands.branch, 0, 'test-branch', '')
      stubSpawnOnce(gitCommands.message, 1, '', 'could not get Git message')
      stubSpawnOnce(gitCommands.email, 1, '', 'could not get Git email')
      stubSpawnOnce(gitCommands.author, 0, 'John Doe', '')
      stubSpawnOnce(gitCommands.sha, 0, 'abc123', '')
      stubSpawnOnce(gitCommands.timestamp, 0, '123', '')
      stubSpawnOnce(gitCommands.remoteOriginUrl, 0, 'git@github.com/repo', '')
      return commitInfo().then(snapshot)
    })
  })
})
