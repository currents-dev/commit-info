'use strict'

/* eslint-env mocha */
const assert = require('assert')
const { getCiCommitInfo, detectCiProvider } = require('./ci')

const SHA = '783b58db0b8048e19f362c35596553f27ad449d5'

const GITLAB_URL =
  'https://gitlab-ci-token:glcbt-64_SECRET@gitlab.com/org/repo.git'

// [name, environment, expected provider, expected fields]
const cases = [
  [
    'GitHub Actions branch push',
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/feature/x',
      GITHUB_REF_NAME: 'feature/x',
      GITHUB_SHA: SHA
    },
    'githubActions',
    { branch: 'feature/x', sha: SHA }
  ],
  [
    'GitHub Actions tag push',
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/tags/v1.2.0',
      GITHUB_REF_NAME: 'v1.2.0',
      GITHUB_REF_TYPE: 'tag',
      GITHUB_SHA: SHA
    },
    'githubActions',
    { branch: 'v1.2.0' }
  ],
  [
    'GitHub Actions tag push without GITHUB_REF_NAME',
    { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/tags/v1.2.0' },
    'githubActions',
    { branch: 'v1.2.0' }
  ],
  [
    'GitHub Actions pull_request',
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REF: 'refs/pull/12/merge',
      GITHUB_REF_NAME: '12/merge',
      GITHUB_HEAD_REF: 'feature/x',
      GITHUB_BASE_REF: 'main',
      GITHUB_SHA: SHA
    },
    'githubActions',
    { branch: 'feature/x', sha: SHA }
  ],
  [
    'GitHub Actions pull_request_target',
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REF_NAME: 'main',
      GITHUB_HEAD_REF: 'feature/x',
      GITHUB_BASE_REF: 'main'
    },
    'githubActions',
    { branch: 'feature/x' }
  ],
  [
    'GitHub Actions workflow_run (the default branch)',
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REF_NAME: 'main',
      GITHUB_HEAD_REF: ''
    },
    'githubActions',
    { branch: 'main' }
  ],
  [
    'GitHub Actions GH_BRANCH set by the user',
    {
      GITHUB_ACTIONS: 'true',
      GH_BRANCH: 'release/2',
      GITHUB_HEAD_REF: 'feature/x'
    },
    'githubActions',
    { branch: 'release/2' }
  ],
  [
    'GitLab branch pipeline',
    {
      GITLAB_CI: 'true',
      CI_COMMIT_REF_NAME: 'feature/x',
      CI_COMMIT_SHA: SHA,
      CI_COMMIT_MESSAGE: 'feat: x',
      GITLAB_USER_NAME: 'Jane',
      GITLAB_USER_EMAIL: 'jane@example.com',
      CI_REPOSITORY_URL: GITLAB_URL
    },
    'gitlab',
    {
      branch: 'feature/x',
      sha: SHA,
      message: 'feat: x',
      author: 'Jane',
      email: 'jane@example.com',
      remote: 'https://gitlab.com/org/repo.git'
    }
  ],
  [
    'GitLab merge request pipeline',
    {
      GITLAB_CI: 'true',
      CI_PIPELINE_SOURCE: 'merge_request_event',
      CI_COMMIT_REF_NAME: 'feature/x',
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feature/x',
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main'
    },
    'gitlab',
    { branch: 'feature/x' }
  ],
  [
    'CircleCI',
    {
      CIRCLECI: 'true',
      CIRCLE_BRANCH: 'feature/x',
      CIRCLE_SHA1: SHA,
      CIRCLE_USERNAME: 'jane',
      CIRCLE_REPOSITORY_URL: 'git@github.com:org/repo.git'
    },
    'circle',
    {
      branch: 'feature/x',
      sha: SHA,
      author: 'jane',
      remote: 'git@github.com:org/repo.git'
    }
  ],
  [
    'Jenkins freestyle job with the Git plugin',
    {
      JENKINS_URL: 'https://ci.example.com/',
      GIT_BRANCH: 'origin/feature/x',
      GIT_COMMIT: SHA
    },
    'jenkins',
    { branch: 'feature/x', sha: SHA }
  ],
  [
    'Jenkins GIT_BRANCH as a remote ref',
    {
      JENKINS_URL: 'https://ci.example.com/',
      GIT_BRANCH: 'refs/remotes/origin/feature/x'
    },
    'jenkins',
    { branch: 'feature/x' }
  ],
  [
    'Jenkins multibranch pull request',
    {
      JENKINS_URL: 'https://ci.example.com/',
      BRANCH_NAME: 'PR-12',
      CHANGE_ID: '12',
      CHANGE_BRANCH: 'feature/x',
      CHANGE_TARGET: 'main',
      GIT_BRANCH: 'PR-12'
    },
    'jenkins',
    { branch: 'feature/x' }
  ],
  [
    'Azure Pipelines CI build of feature/x, BUILD_SOURCEBRANCHNAME is the last segment',
    {
      TF_BUILD: 'True',
      AZURE_HTTP_USER_AGENT: 'agent',
      BUILD_SOURCEBRANCH: 'refs/heads/feature/x',
      BUILD_SOURCEBRANCHNAME: 'x',
      BUILD_SOURCEVERSION: SHA,
      BUILD_REPOSITORY_URI: 'https://org@dev.azure.com/org/p/_git/repo'
    },
    'azure',
    {
      branch: 'x',
      sha: SHA,
      remote: 'https://dev.azure.com/org/p/_git/repo'
    }
  ],
  [
    'Azure Pipelines pull request from feature/x',
    {
      TF_BUILD: 'True',
      AZURE_HTTP_USER_AGENT: 'agent',
      BUILD_REASON: 'PullRequest',
      BUILD_SOURCEBRANCH: 'refs/pull/7/merge',
      BUILD_SOURCEBRANCHNAME: 'merge',
      SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/feature/x',
      SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main',
      SYSTEM_PULLREQUEST_SOURCEREPOSITORYURI: 'https://github.com/org/repo'
    },
    'azure',
    { branch: 'feature/x', remote: 'https://github.com/org/repo' }
  ],
  [
    'Azure Pipelines tag build',
    {
      TF_BUILD: 'True',
      AZURE_HTTP_USER_AGENT: 'agent',
      BUILD_SOURCEBRANCH: 'refs/tags/v1.2.0',
      BUILD_SOURCEBRANCHNAME: 'v1.2.0'
    },
    'azure',
    { branch: 'v1.2.0' }
  ],
  [
    'Bamboo',
    {
      bamboo_buildNumber: '5',
      bamboo_planRepository_revision: SHA,
      bamboo_planRepository_branch: 'feature/x',
      bamboo_planRepository_username: 'jane',
      bamboo_planRepository_repositoryUrl: 'https://github.com/org/repo.git'
    },
    'bamboo',
    {
      branch: 'feature/x',
      sha: SHA,
      author: 'jane',
      remote: 'https://github.com/org/repo.git'
    }
  ],
  [
    'Bitbucket Pipelines',
    {
      BITBUCKET_BUILD_NUMBER: '5',
      BITBUCKET_BRANCH: 'feature/x',
      BITBUCKET_COMMIT: SHA
    },
    'bitbucket',
    { branch: 'feature/x', sha: SHA }
  ],
  [
    'Buildkite',
    {
      BUILDKITE: 'true',
      BUILDKITE_BRANCH: 'feature/x',
      BUILDKITE_COMMIT: SHA,
      BUILDKITE_MESSAGE: 'feat: x',
      BUILDKITE_BUILD_CREATOR: 'Jane',
      BUILDKITE_BUILD_CREATOR_EMAIL: 'jane@example.com',
      BUILDKITE_REPO: 'git@github.com:org/repo.git'
    },
    'buildkite',
    {
      branch: 'feature/x',
      sha: SHA,
      message: 'feat: x',
      author: 'Jane',
      email: 'jane@example.com',
      remote: 'git@github.com:org/repo.git'
    }
  ],
  [
    'AWS CodeBuild, no branch',
    {
      CODEBUILD_BUILD_ID: 'p:1',
      CODEBUILD_WEBHOOK_HEAD_REF: 'refs/heads/feature/x',
      CODEBUILD_SOURCE_VERSION: SHA,
      CODEBUILD_RESOLVED_SOURCE_VERSION: SHA,
      CODEBUILD_SOURCE_REPO_URL: 'https://github.com/org/repo.git'
    },
    'awsCodeBuild',
    {
      branch: null,
      sha: SHA,
      remote: 'https://github.com/org/repo.git'
    }
  ],
  [
    'Semaphore',
    {
      SEMAPHORE: 'true',
      SEMAPHORE_GIT_SHA: SHA,
      SEMAPHORE_GIT_BRANCH: 'feature/x',
      SEMAPHORE_GIT_URL: 'git@github.com:org/repo.git',
      SEMAPHORE_GIT_REPO_SLUG: 'org/repo'
    },
    'semaphore',
    {
      branch: 'feature/x',
      sha: SHA,
      remote: 'git@github.com:org/repo.git'
    }
  ],
  ['no CI', {}, null, { branch: null, sha: null, remote: null }]
]

describe('getCiCommitInfo', () => {
  cases.forEach(([name, env, provider, expected]) => {
    it(name, () => {
      const info = getCiCommitInfo(env)
      assert.strictEqual(info.provider, provider)
      assert.strictEqual(detectCiProvider(env), provider)
      Object.keys(expected).forEach(field => {
        assert.strictEqual(info[field], expected[field], field)
      })
    })
  })

  it('returns null for each field the provider does not set', () => {
    assert.deepStrictEqual(
      getCiCommitInfo({ BITBUCKET_BUILD_NUMBER: '5', BITBUCKET_BRANCH: 'x' }),
      {
        provider: 'bitbucket',
        branch: 'x',
        message: null,
        email: null,
        author: null,
        sha: null,
        remote: null,
        timestamp: null
      }
    )
  })
})
