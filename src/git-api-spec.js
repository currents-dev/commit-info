'use strict'

const la = require('lazy-ass')
const is = require('check-more-types')
const chdir = require('chdir-promise')
const { stubSpawnOnce } = require('stub-spawn-once')
const Promise = require('bluebird')
const snapshot = require('snap-shot-it')
const { join } = require('path')
const assert = require('assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const util = require('util')
const createDebug = require('debug')
const mockedEnv = require('mocked-env')

/* eslint-env mocha */
describe('git-api', () => {
  const { gitCommands } = require('./git-api')

  context('getGitBranch', () => {
    const { getGitBranch } = require('./git-api')

    let currentBranch

    before(() => {
      return getGitBranch().then(x => {
        currentBranch = x
        console.log('current git branch is', x)
      })
    })

    it('is a function', () => {
      la(is.fn(getGitBranch))
    })

    // we cannot run this test during pre-commit hook
    // because the branch command fails with an error
    //  fatal: Not a git repository: '.git'
    // thus we usually skip it locally and run on CI
    // on CI the branch is also usually "HEAD" but we want actual
    // branch there. So it really makes sense to run this
    // test locally, but not when committing
    it('finds branch in given repo folder', () => {
      if (currentBranch === null) {
        return
      }
      console.log('current branch "%s"', currentBranch)

      la(
        is.unemptyString(currentBranch),
        'missing branch in current folder',
        currentBranch
      )

      const outsideFolder = join(__dirname, '..', '..')
      // assume repo folder is current working directory!
      const repoFolder = process.cwd()
      return chdir
        .to(outsideFolder)
        .then(() => getGitBranch(repoFolder))
        .finally(chdir.back)
        .then(branch => {
          la(is.unemptyString(branch), 'missing branch with given path', branch)
          la(
            branch === currentBranch,
            'two branch values should be the same',
            branch,
            currentBranch
          )
        })
    })
  })

  describe('subject and body', () => {
    const { getSubject, getBody } = require('./git-api')

    it('gets subject and body', () => {
      stubSpawnOnce(gitCommands.subject, 0, 'commit does this', '')
      stubSpawnOnce(gitCommands.body, 0, 'more details', '')
      return Promise.props({
        subject: getSubject(),
        body: getBody()
      }).then(snapshot)
    })
  })

  describe('getting commit info', () => {
    const {
      getMessage,
      getEmail,
      getAuthor,
      getSha,
      getRemoteOrigin,
      getTimestamp
    } = require('./git-api')

    it('works', () => {
      stubSpawnOnce(gitCommands.message, 0, 'important commit', '')
      stubSpawnOnce(gitCommands.email, 0, 'me@foo.com', '')
      stubSpawnOnce(gitCommands.author, 0, 'John Doe', '')
      stubSpawnOnce(gitCommands.sha, 0, 'abc123', '')
      stubSpawnOnce(gitCommands.timestamp, 0, '123', '')
      stubSpawnOnce(gitCommands.remoteOriginUrl, 0, 'git@github.com/repo', '')

      return Promise.props({
        message: getMessage(),
        email: getEmail(),
        author: getAuthor(),
        sha: getSha(),
        remote: getRemoteOrigin(),
        timestamp: getTimestamp()
      }).then(snapshot)
    })
  })
  describe('in a repository', function () {
    this.timeout(10000)

    const TOKEN = 'glcbt-64_SECRET_TOKEN'
    const { runGitCommandWithError, readRemoteOrigin } = require('./git-api')

    let root, restoreEnvironment

    const env = extra =>
      mockedEnv(
        Object.assign(
          { PATH: process.env.PATH, HOME: process.env.HOME },
          extra
        ),
        { clear: true }
      )

    beforeEach(() => {
      root = fs.mkdtempSync(join(os.tmpdir(), 'git-api-'))
      execFileSync('git', ['init', '-q', root])
    })

    afterEach(() => {
      restoreEnvironment()
      fs.rmSync(root, { recursive: true, force: true })
    })

    it('returns no value and no error when the remote is not set', () => {
      restoreEnvironment = env({})
      return runGitCommandWithError(gitCommands.remoteOriginUrl, root).then(
        result => assert.deepStrictEqual(result, { value: null, error: null })
      )
    })

    describe('readRemoteOrigin when another user owns the repository', () => {
      let debugLines, restoreDebug

      beforeEach(() => {
        execFileSync('git', [
          ...['-C', root, 'remote', 'add', 'origin'],
          `https://gitlab-ci-token:${TOKEN}@gitlab.com/org/repo.git`
        ])
        debugLines = []
        const namespaces = createDebug.disable()
        const log = createDebug.log
        createDebug.log = (...args) => debugLines.push(util.format(...args))
        createDebug.enable('commit-info')
        restoreDebug = () => {
          createDebug.log = log
          createDebug.enable(namespaces)
        }
      })

      afterEach(() => {
        restoreDebug()
      })

      it('reads the empty value again on CI, without credentials', () => {
        restoreEnvironment = env({
          CI: 'true',
          GIT_TEST_ASSUME_DIFFERENT_OWNER: '1'
        })
        return readRemoteOrigin(root).then(result => {
          assert.deepStrictEqual(result, {
            value: 'https://gitlab.com/org/repo.git',
            error: null
          })
          const output = debugLines.join('\n')
          assert(output.includes('https://gitlab.com/org/repo.git'), output)
          assert(!output.includes(TOKEN), output)
        })
      })

      it('does not read it again outside CI', () => {
        restoreEnvironment = env({ GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' })
        return readRemoteOrigin(root).then(result =>
          assert.deepStrictEqual(result, { value: null, error: null })
        )
      })
    })
  })
})
