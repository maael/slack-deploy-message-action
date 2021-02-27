import * as core from '@actions/core'
import fetch from 'node-fetch'
import * as github from '@actions/github'

async function run(): Promise<void> {
  try {
    const commit = await getCommit()
    const statusCommit = await getServiceStatus()

    const octo = github.getOctokit(core.getInput('github_token'))

    const repoFull =
      core.getInput('repo') ||
      `${github.context.repo.repo}/${github.context.repo.owner}`
    const repoParts = repoFull.split('/')
    const owner = repoParts[0]
    const repo = repoParts[1]
    const environment = core.getInput('environment') || 'unknown environment'

    const slackMap = await getSlackMap(octo)
    core.debug(JSON.stringify(slackMap))

    const diffList = await getDiff(
      octo,
      owner,
      repo,
      slackMap,
      commit,
      statusCommit
    )

    const message = `Deployed <https://github.com/${owner}/${repo}/commit/${commit}|${commit}> in <https://github.com/${owner}/${repo}|${owner}/${repo}> to ${environment}:
${diffList}
    `

    await sendToSlack(message)
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function getSlackMap(
  octokit: ReturnType<typeof github.getOctokit>
): Promise<{[k: string]: string}> {
  const slackMapRepo = core.getInput('slack_map_repo')
  const repoParts = slackMapRepo.split('/')
  const slackMapFile = core.getInput('slack_map_file') || 'mapping.json'
  core.debug(
    `Getting slack map from ${repoParts[0]}/${repoParts[1]} in ${slackMapFile}`
  )
  let result
  try {
    result = ((await octokit.request(
      'GET /repos/{owner}/{repo}/contents/{path}',
      {
        owner: repoParts[0],
        repo: repoParts[1],
        path: slackMapFile
      }
    )) as unknown) as {data: {download_url: string}}
  } catch (e) {
    core.error(
      `Failed to get slack map ${repoParts[0]}/${repoParts[1]} in ${slackMapFile}: ${e.message}`
    )
    throw e
  }

  let downloaded = {}
  try {
    downloaded = await (await fetch(result.data.download_url)).json()
  } catch (e) {
    core.error(`Failed to download slack map: ${e.message}`)
  }

  return downloaded
}

async function getDiff(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  slackMap: {[k: string]: string},
  base: string,
  head: string
): Promise<unknown> {
  try {
    const result = await octokit.request(
      'GET /repos/{owner}/{repo}/compare/{base}...{head}',
      {
        owner,
        repo,
        base,
        head
      }
    )
    const diffMessage = result.data.commits
      .map(c => {
        return formatMessage(slackMap, c)
      })
      .reverse()
      .join('\n')
    return diffMessage
  } catch (e) {
    core.error(
      `Failed to get diff for ${owner}/${repo} ${base}...${head}: ${e.message}`
    )
    throw e
  }
}

function formatMessage(slackMap: {[k: string]: string}, c: any) {
  const matchingSlack = slackMap[c.committer?.login || '']
  const committer = matchingSlack
    ? `<@${matchingSlack}>`
    : `[${c.committer?.login}](${c.committer?.html_url})`
  return `- ${committer} <${c.html_url}|${c.commit.message}>`
}

async function getServiceStatus(): Promise<string> {
  try {
    const serviceUrl = core.getInput('service_status_url')
    const statusCommitField =
      core.getInput('status_commit_field') || 'BUILD_COMMIT'
    const status = await fetch(serviceUrl)
    const statusJson = await status.json()
    const statusCommit = statusJson[statusCommitField]
    return statusCommit
  } catch (e) {
    core.error(`Failed to get service status: ${e.message}`)
    throw e
  }
}

async function sendToSlack(message: string) {
  if (core.getInput('dry_run')) {
    core.debug(`Skipping sending message: ${message}`)
    return
  }
  try {
    const channel = core.getInput('channel')
    const icon_emoji = core.getInput('icon_emoji') || ':tada:'
    const username = core.getInput('username') || 'Workflow Deploy Message'
    await fetch(core.getInput('slack_webhook'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: message,
        channel,
        username,
        icon_emoji
      })
    })
  } catch (e) {
    core.error(`Failed to send to slack: ${e.message}`)
    throw e
  }
}

async function getCommit(): Promise<string> {
  return core.getInput('commit') || github.context.sha
}

run()
