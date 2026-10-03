'use strict'

const { detectCiProvider } = require('./ci-provider')
const { removeCredentials } = require('./remove-credentials')
const { getFields } = require('./utils')

const join = (...pieces) => pieces.filter(Boolean).join('\n')

// Each provider's commit values. Field names match commitInfo().
const providerCommits = {
  appveyor: env => ({
    sha: env.APPVEYOR_REPO_COMMIT,
    // APPVEYOR_REPO_BRANCH is the target branch on a pull request
    branch:
      env.APPVEYOR_PULL_REQUEST_HEAD_REPO_BRANCH || env.APPVEYOR_REPO_BRANCH,
    message: join(
      env.APPVEYOR_REPO_COMMIT_MESSAGE,
      env.APPVEYOR_REPO_COMMIT_MESSAGE_EXTENDED
    ),
    author: env.APPVEYOR_REPO_COMMIT_AUTHOR,
    email: env.APPVEYOR_REPO_COMMIT_AUTHOR_EMAIL
  }),
  /** @see https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html */
  awsCodeBuild: env => ({
    sha: env.CODEBUILD_RESOLVED_SOURCE_VERSION,
    remote: env.CODEBUILD_SOURCE_REPO_URL
  }),
  /** @see https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables */
  azure: env => ({
    sha: env.BUILD_SOURCEVERSION,
    branch: env.SYSTEM_PULLREQUEST_SOURCEBRANCH
      ? env.SYSTEM_PULLREQUEST_SOURCEBRANCH.replace(/^refs\/heads\//, '')
      : env.BUILD_SOURCEBRANCHNAME,
    message: env.BUILD_SOURCEVERSIONMESSAGE,
    author: env.BUILD_SOURCEVERSIONAUTHOR,
    email: env.BUILD_REQUESTEDFOREMAIL,
    remote:
      env.SYSTEM_PULLREQUEST_SOURCEREPOSITORYURI || env.BUILD_REPOSITORY_URI
  }),
  /** @see https://confluence.atlassian.com/bamboo/bamboo-variables-289277087.html */
  bamboo: env => ({
    sha: env.bamboo_planRepository_revision,
    branch: env.bamboo_planRepository_branch,
    author: env.bamboo_planRepository_username,
    remote: env.bamboo_planRepository_repositoryUrl
  }),
  /** @see https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/ */
  bitbucket: env => ({
    sha: env.BITBUCKET_COMMIT,
    branch: env.BITBUCKET_BRANCH
  }),
  /** @see https://buildkite.com/docs/pipelines/environment-variables */
  buildkite: env => ({
    sha: env.BUILDKITE_COMMIT,
    branch: env.BUILDKITE_BRANCH,
    message: env.BUILDKITE_MESSAGE,
    author: env.BUILDKITE_BUILD_CREATOR,
    email: env.BUILDKITE_BUILD_CREATOR_EMAIL,
    remote: env.BUILDKITE_REPO
  }),
  /** @see https://circleci.com/docs/variables/ */
  circle: env => ({
    sha: env.CIRCLE_SHA1,
    branch: env.CIRCLE_BRANCH,
    author: env.CIRCLE_USERNAME,
    remote: env.CIRCLE_REPOSITORY_URL
  }),
  codeFresh: env => ({
    sha: env.CF_REVISION,
    branch: env.CF_BRANCH,
    message: env.CF_COMMIT_MESSAGE,
    author: env.CF_COMMIT_AUTHOR
  }),
  drone: env => ({
    sha: env.DRONE_COMMIT_SHA,
    branch: env.DRONE_SOURCE_BRANCH,
    message: env.DRONE_COMMIT_MESSAGE,
    author: env.DRONE_COMMIT_AUTHOR,
    email: env.DRONE_COMMIT_AUTHOR_EMAIL,
    remote: env.DRONE_GIT_HTTP_URL
  }),
  /** @see https://docs.github.com/en/actions/reference/variables-reference */
  githubActions: env => ({
    sha: env.GITHUB_SHA,
    // GITHUB_HEAD_REF is set on pull_request and pull_request_target only
    branch:
      env.GH_BRANCH ||
      env.GITHUB_HEAD_REF ||
      env.GITHUB_REF_NAME ||
      (env.GITHUB_REF && env.GITHUB_REF.replace(/^refs\/(heads|tags)\//, ''))
  }),
  /** @see https://docs.gitlab.com/ee/ci/variables/predefined_variables.html */
  gitlab: env => ({
    sha: env.CI_COMMIT_SHA,
    branch: env.CI_COMMIT_REF_NAME,
    message: env.CI_COMMIT_MESSAGE,
    author: env.GITLAB_USER_NAME,
    email: env.GITLAB_USER_EMAIL,
    // holds a job token: https://gitlab-ci-token:<token>@host/o/r.git
    remote: env.CI_REPOSITORY_URL
  }),
  googleCloud: env => ({
    sha: env.COMMIT_SHA,
    branch: env.BRANCH_NAME
  }),
  /**
   * CHANGE_BRANCH is the pull request branch in multibranch pipelines.
   * GIT_BRANCH (Git plugin) names the remote branch, as in `origin/main`.
   * @see https://plugins.jenkins.io/git/
   */
  jenkins: env => ({
    sha: env.GIT_COMMIT,
    branch:
      env.CHANGE_BRANCH ||
      (env.GIT_BRANCH &&
        env.GIT_BRANCH.replace(
          /^(refs\/remotes\/|refs\/heads\/)?origin\//,
          ''
        ).replace(/^refs\/heads\//, ''))
  }),
  /** @see https://docs.semaphoreci.com/reference/env-vars */
  semaphore: env => ({
    sha: env.SEMAPHORE_GIT_SHA,
    branch: env.SEMAPHORE_GIT_BRANCH,
    remote: env.SEMAPHORE_GIT_URL
  }),
  travis: env => ({
    sha: env.TRAVIS_PULL_REQUEST_SHA || env.TRAVIS_COMMIT,
    // TRAVIS_BRANCH is the target branch on a pull request
    branch: env.TRAVIS_PULL_REQUEST_BRANCH || env.TRAVIS_BRANCH,
    message: env.TRAVIS_COMMIT_MESSAGE
  }),
  netlify: env => ({
    sha: env.COMMIT_REF,
    branch: env.BRANCH,
    remote: env.REPOSITORY_URL
  })
}

/**
 * Reads the commit from the CI provider's variables. Fields the provider does
 * not set are null; no provider sets the timestamp. The remote has no
 * credentials.
 *
 * @returns {{provider: string|null, branch, message, email, author, sha, remote, timestamp}}
 */
function getCiCommitInfo (env = process.env) {
  const provider = detectCiProvider(env)
  const values =
    provider && providerCommits[provider] ? providerCommits[provider](env) : {}
  const commit = { provider }
  getFields().forEach(field => {
    commit[field] = values[field] || null
  })
  commit.remote = removeCredentials(commit.remote)
  return commit
}

module.exports = { detectCiProvider, getCiCommitInfo }
