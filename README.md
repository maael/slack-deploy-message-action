<p align="center">
  <a href="https://github.com/maael/slack-deploy-message-action/actions"><img alt="slack-deploy-message-action status" src="https://github.com/maael/slack-deploy-message-action/workflows/build-test/badge.svg"></a>
</p>

# slack-deploy-message-action

This action will send a nice deploy message in slack, including:

- Listing the commits between what's on the service and what you're deploying
- Pinging the authors of the commits via slack in the message

## Usage

```yml
- uses: maael/slack-deploy-message-action
  with:
    slack_webhook: ${{env.SLACK_WEBHOOK}}
    github_token: ${{env.GITHUB_PAT_TOKEN}}
    commit: '25e6c46a48a3052c27b8f35e2e3cd513193ce9a8'
    service_status_url: https://next.staging.threads.team/api/status
    repo: ThreadsStyling/web-app-next-template
    slack_map_repo: maael/github-slack-mapping
    channels: UCATYBYG1
    failure_channels: UCATYBYG1
    environment: staging
- uses: maael/slack-deploy-message-action
  if: always()
  with:
    slack_webhook: ${{env.SLACK_WEBHOOK}}
    github_token: ${{env.GITHUB_PAT_TOKEN}}
    commit: '25e6c46a48a3052c27b8f35e2e3cd513193ce9a8'
    service_status_url: https://next.staging.threads.team/api/status
    repo: ThreadsStyling/web-app-next-template
    slack_map_repo: maael/github-slack-mapping
    channels: UCATYBYG1
    failure_channels: UCATYBYG1
    environment: staging
    status: ${{job.status}}
```


## Inputs

```yml
inputs:
  slack_webhook:
    required: true
    description: 'The Slack Webhook'
  github_token:
    required: true
    description: 'GitHub token'
  commit:
    description: 'The commit sha to use as the HEAD, defaults to the current sha'
  service_status_url:
    required: true
    description: 'The url for the service status to check the commit field of'
  status_commit_field:
    description: 'The field with the commit sha'
    default: 'BUILD_COMMIT'
  repo:
    description: 'The repo in form OWNER/NAME to use, defaults to current'
  slack_map_repo:
    required: true
    description: 'The repo that the slack mapping file is in in form OWNER/NAME'
  slack_map_file:
    description: 'The path to the slack mapping file in the repo'
    default: 'mapping.json'
  channels:
    required: true
    description: 'A comma separated list of IDs of the Slack Channels to send to'
  failure_channels:
    required: true
    description: 'A comma separated list of IDs of the Slack Channels to send to on a failure'
  icon_emoji:
    description: 'The icon for messages from a legacy slack webhook'
    default: ':tada:'
  username:
    description: 'The username for messages from a legacy slack webhook'
    default: 'Workflow Deploy Message'
  environment:
    description: 'The environment being deployed to'
  dry_run:
    description: 'If set, wil skip sending message to slack'
  message_template:
    description: 'The template to use for the base message, commits will be added as context blocks'
    default: ':octocat: $ENV_ICON $ACTOR_LINK deployed $COMMIT_LINK in $REPO_LINK to $ENV_LINK'
  status:
    description: 'The job status, when not provided it causes a deploying message to be sent'
```

## Publishing

Actions are run from GitHub repos so we will checkin the packed dist folder.

Then run [ncc](https://github.com/zeit/ncc) and push the results:
```bash
$ npm run package
$ git add dist
$ git commit -a -m "prod dependencies"
$ git tag -fa v1.0.0 -m "v1.0.0"
$ git push --tags
$ git checkout v1
$ git push origin v1 --force
$ git checkout main
```

## Local Testing

Install [act](https://github.com/nektos/act) via brew.

Then make a copy of the `.env.schema` in `.env`, and fill it out with the expected environment variables.

You can then run `act -j local`.

Make sure to run `yarn run build && yarn run package` first to use the latest version of the action.
