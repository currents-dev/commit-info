'use strict'

const anyKey = (env, pattern) => Object.keys(env).some(key => pattern.test(key))

// The order matters when the variables of two providers are set: the first
// match wins. It is the order the Currents clients detect providers in.
const CI_PROVIDERS = [
  ['appveyor', env => env.APPVEYOR],
  ['azure', env => env.TF_BUILD && env.AZURE_HTTP_USER_AGENT],
  ['awsCodeBuild', env => anyKey(env, /^CODEBUILD_/)],
  ['bamboo', env => env.bamboo_buildNumber],
  ['bitbucket', env => env.BITBUCKET_BUILD_NUMBER],
  ['buildkite', env => env.BUILDKITE],
  ['circle', env => env.CIRCLECI],
  ['concourse', env => anyKey(env, /^CONCOURSE_/)],
  ['codeFresh', env => env.CF_BUILD_ID],
  ['drone', env => env.DRONE],
  ['githubActions', env => env.GITHUB_ACTIONS],
  [
    'gitlab',
    env =>
      env.GITLAB_CI ||
      (env.CI_SERVER_NAME && /^GitLab/.test(env.CI_SERVER_NAME))
  ],
  ['goCD', env => env.GO_JOB_NAME],
  [
    'jenkins',
    env =>
      env.JENKINS_URL ||
      env.JENKINS_HOME ||
      env.JENKINS_VERSION ||
      env.HUDSON_URL ||
      env.HUDSON_HOME
  ],
  [
    'googleCloud',
    env =>
      (env.BUILD_ID && env.PROJECT_ID && env.PROJECT_NUMBER) ||
      env.GCP_PROJECT ||
      env.GCLOUD_PROJECT ||
      env.GOOGLE_CLOUD_PROJECT
  ],
  ['semaphore', env => env.SEMAPHORE],
  ['teamcity', env => env.TEAMCITY_VERSION],
  ['travis', env => env.TRAVIS],
  ['netlify', env => env.NETLIFY]
]

/**
 * Returns the name of the CI provider the process runs on, or null.
 */
function detectCiProvider (env = process.env) {
  const found = CI_PROVIDERS.find(([, isProvider]) => isProvider(env))
  return found ? found[0] : null
}

module.exports = { detectCiProvider }
