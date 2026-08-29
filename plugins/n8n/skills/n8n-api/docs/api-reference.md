# n8n Public API — endpoint reference

Generated from the OpenAPI document this instance serves (`n8n Public API 1.1.1`, OpenAPI 3.0).
**Not a static truth**: run `spec --grep <term>` against the target instance to confirm what
that particular n8n version exposes.

- Base URL: `<instance>/api/v1`
- Auth header: `X-N8N-API-KEY: <key>` (also accepts a JWT `Authorization: Bearer`)
- Pagination: `limit` (default 100, **max 250**) + `cursor`; responses carry `nextCursor`
- Errors: `{ "message": "..." }` with 400 / 401 / 403 / 404 / 409 / 415 / 500

Every route below is reachable with `call <METHOD> <path>` even when the script has no
dedicated subcommand for it.

## `/audit`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/audit` | Generate an audit | — | `object` |

## `/settings`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| GET | `/settings/ldap` | Retrieve the LDAP configuration | — | — |
| PUT | `/settings/ldap` | Set the LDAP configuration | — | `ldap-configuration.update` |
| GET | `/settings/ldap/sync` | Retrieve LDAP synchronization history | `limit`, `cursor` | — |
| POST | `/settings/ldap/sync` | Trigger an LDAP synchronization | — | `ldap-sync.update` |
| GET | `/settings/security-policy` | Retrieve the security policy | — | — |
| PUT | `/settings/security-policy` | Set the security policy | — | `security-policy.update` |
| GET | `/settings/otel` | Retrieve the OpenTelemetry configuration | — | — |
| PUT | `/settings/otel` | Set the OpenTelemetry configuration | — | `otel-settings` |
| POST | `/settings/otel/test-trace` | Test the connection to an OTLP collector | — | `otel-test-trace` |
| GET | `/settings/sso/oidc` | Retrieve the OIDC SSO configuration | — | — |
| PUT | `/settings/sso/oidc` | Set the OIDC SSO configuration | — | `oidc-configuration.update` |
| GET | `/settings/sso/saml` | Retrieve the SAML SSO configuration | — | — |
| PUT | `/settings/sso/saml` | Set the SAML SSO configuration | — | `saml-configuration.update` |
| GET | `/settings/log-streaming/event-types` | List streamable event types | — | — |
| GET | `/settings/log-streaming/destinations` | List log streaming destinations | — | — |
| POST | `/settings/log-streaming/destinations` | Create a log streaming destination | — | `destination` |
| POST | `/settings/log-streaming/destinations/{id}/test` | Send a test message to a log streaming destination | `id` | — |
| GET | `/settings/log-streaming/destinations/{id}` | Retrieve a log streaming destination | `id` | — |
| PUT | `/settings/log-streaming/destinations/{id}` | Update a log streaming destination | `id` | `destination` |
| DELETE | `/settings/log-streaming/destinations/{id}` | Delete a log streaming destination | `id` | — |

## `/credentials`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| GET | `/credentials` | List credentials | `limit`, `cursor` | — |
| POST | `/credentials` | Create a credential | — | `credentialCreate` |
| GET | `/credentials/{id}` | Get credential by ID | `id` | — |
| PATCH | `/credentials/{id}` | Update credential by ID | `id` | `update-credential-request` |
| DELETE | `/credentials/{id}` | Delete credential by ID | `id` | — |
| POST | `/credentials/{id}/test` | Test credential by ID | `id` | — |
| GET | `/credentials/schema/{credentialTypeName}` | Show credential data schema | `credentialTypeName` | — |
| PUT | `/credentials/{id}/transfer` | Transfer a credential to another project. | `id` | `object` |

## `/executions`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| GET | `/executions` | Retrieve all executions | `includeData`, `ignoreDataSizeLimit`, `redactExecutionData`, `status=canceled\|crashed\|error\|new\|running\|success\|unknown\|waiting`, `workflowId`, `projectId`, `limit`, `cursor` | — |
| GET | `/executions/{id}` | Retrieve an execution | `id`, `includeData`, `ignoreDataSizeLimit`, `redactExecutionData` | — |
| DELETE | `/executions/{id}` | Delete an execution | `id` | — |
| POST | `/executions/{id}/retry` | Retry an execution | `id` | `object` |
| POST | `/executions/{id}/stop` | Stop an execution | `id` | — |
| POST | `/executions/stop` | Stop multiple executions | — | `object` |
| GET | `/executions/{id}/tags` | Get execution tags | `id` | — |
| PUT | `/executions/{id}/tags` | Update tags of an execution | `id` | `tagIds` |

## `/tags`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/tags` | Create a tag | — | `tag` |
| GET | `/tags` | Retrieve all tags | `limit`, `cursor` | — |
| GET | `/tags/{id}` | Retrieves a tag | `id` | — |
| DELETE | `/tags/{id}` | Delete a tag | `id` | — |
| PUT | `/tags/{id}` | Update a tag | `id` | `tag` |

## `/workflows`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/workflows` | Create a workflow | — | `workflowCreate` |
| GET | `/workflows` | Retrieve all workflows | `offset`, `limit`, `cursor`, `active=true\|false`, `tags`, `name`, `projectId`, `excludePinnedData=true\|false` | — |
| DELETE | `/workflows/{id}` | Delete a workflow | `id` | — |
| PUT | `/workflows/{id}` | Update a workflow | `id`, `publishIfActive` | `workflow` |
| GET | `/workflows/{id}/{versionId}` | Retrieves a specific version of a workflow | `id`, `versionId` | — |
| POST | `/workflows/{id}/activate` | Publish a workflow | `id` | `object` |
| POST | `/workflows/{id}/deactivate` | Deactivate a workflow | `id` | — |
| POST | `/workflows/{id}/publish` | Publish a workflow | `id` | `object` |
| POST | `/workflows/{id}/unpublish` | Unpublish a workflow | `id` | — |
| POST | `/workflows/{id}/archive` | Archive a workflow | `id` | — |
| POST | `/workflows/{id}/unarchive` | Unarchive a workflow | `id` | — |
| PUT | `/workflows/{id}/transfer` | Transfer a workflow to another project | `id` | `object` |
| GET | `/workflows/{id}/test-runs` | Retrieve test runs | `id`, `status=new\|running\|completed\|error\|cancelled`, `limit`, `cursor` | — |
| POST | `/workflows/{id}/test-runs` | Trigger a test run | `id` | — |
| GET | `/workflows/{id}/test-runs/{runId}` | Retrieve a test run | `id`, `runId` | — |
| POST | `/workflows/{id}/test-runs/{runId}/cancel` | Cancel a test run | `id`, `runId` | — |
| GET | `/workflows/{id}/test-runs/{runId}/test-cases` | Retrieve test run cases | `id`, `runId`, `limit`, `cursor` | — |
| GET | `/workflows/{workflowId}` | Retrieve a workflow | `workflowId`, `excludePinnedData=true\|false` | — |
| GET | `/workflows/{workflowId}/history` | Retrieve workflow version history | `limit`, `cursor`, `workflowId` | — |
| GET | `/workflows/{workflowId}/tags` | Get workflow tags | `workflowId` | — |
| PUT | `/workflows/{workflowId}/tags` | Update tags of a workflow | `workflowId` | `array` |

## `/users`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| GET | `/users` | Retrieve all users | `limit`, `offset`, `cursor`, `includeRole`, `projectId` | — |
| POST | `/users` | Create multiple users | — | `array` |
| GET | `/users/{id}` | Get user by ID/Email | `id`, `includeRole` | — |
| DELETE | `/users/{id}` | Delete a user | `id` | — |
| PATCH | `/users/{id}/role` | Change a user's global role | `id` | `object` |

## `/source-control`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/source-control/pull` | Pull changes from the remote repository | — | `pull` |

## `/variables`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/variables` | Create a variable | — | `variable.create` |
| GET | `/variables` | Retrieve variables | `limit`, `cursor`, `projectId`, `state=empty` | — |
| DELETE | `/variables/{id}` | Delete a variable | `id` | — |
| PUT | `/variables/{id}` | Update a variable | `id` | `variable.create` |

## `/data-tables`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| GET | `/data-tables` | List all data tables | `limit`, `cursor`, `filter`, `sortBy` | — |
| POST | `/data-tables` | Create a new data table | — | `createDataTableRequest` |
| GET | `/data-tables/{dataTableId}` | Get a data table | `dataTableId` | — |
| PATCH | `/data-tables/{dataTableId}` | Update a data table | `dataTableId` | `updateDataTableRequest` |
| DELETE | `/data-tables/{dataTableId}` | Delete a data table | `dataTableId` | — |
| GET | `/data-tables/{dataTableId}/rows` | Retrieve rows from a data table | `dataTableId`, `limit`, `cursor`, `filter`, `sortBy`, `search` | — |
| POST | `/data-tables/{dataTableId}/rows` | Insert rows into a data table | `dataTableId` | `insertRowsRequest` |
| PATCH | `/data-tables/{dataTableId}/rows/update` | Update rows in a data table | `dataTableId` | `updateRowsRequest` |
| POST | `/data-tables/{dataTableId}/rows/upsert` | Upsert a row in a data table | `dataTableId` | `upsertRowRequest` |
| DELETE | `/data-tables/{dataTableId}/rows/clear` | Clear all rows from a data table | `dataTableId` | — |
| DELETE | `/data-tables/{dataTableId}/rows/delete` | Delete rows from a data table | `dataTableId`, `filter`, `returnData`, `dryRun` | — |
| GET | `/data-tables/{dataTableId}/columns` | List columns of a data table | `dataTableId` | — |
| POST | `/data-tables/{dataTableId}/columns` | Add a column to a data table | `dataTableId` | `createColumnRequest` |
| DELETE | `/data-tables/{dataTableId}/columns/{columnId}` | Delete a column | `dataTableId`, `columnId` | — |
| PATCH | `/data-tables/{dataTableId}/columns/{columnId}` | Update a column | `dataTableId`, `columnId` | `updateColumnRequest` |

## `/projects`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/projects` | Create a project | — | `project` |
| GET | `/projects` | Retrieve projects | `limit`, `cursor` | — |
| DELETE | `/projects/{projectId}` | Delete a project | `projectId` | — |
| PUT | `/projects/{projectId}` | Update a project | `projectId` | `project` |
| GET | `/projects/{projectId}/users` | List project members | `projectId`, `limit`, `cursor` | — |
| POST | `/projects/{projectId}/users` | Add one or more users to a project | `projectId` | `object` |
| DELETE | `/projects/{projectId}/users/{userId}` | Delete a user from a project | `projectId`, `userId` | — |
| PATCH | `/projects/{projectId}/users/{userId}` | Change a user's role in a project | `projectId`, `userId` | `object` |
| POST | `/projects/{projectId}/folders` | Create a folder | `projectId` | `folder.create` |
| GET | `/projects/{projectId}/folders` | Retrieve folders | `projectId`, `filter`, `select`, `sortBy=name:asc\|name:desc\|createdAt:asc\|createdAt:desc\|updatedAt:asc\|updatedAt:desc`, `skip`, `take` | — |
| DELETE | `/projects/{projectId}/folders/{folderId}` | Delete a folder | `projectId`, `folderId`, `transferToFolderId` | — |
| GET | `/projects/{projectId}/folders/{folderId}` | Get folder details | `projectId`, `folderId` | — |
| PATCH | `/projects/{projectId}/folders/{folderId}` | Update a folder | `projectId`, `folderId` | `folder.update` |

## `/community-packages`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/community-packages` | Install a community package | — | `installCommunityPackageRequest` |
| GET | `/community-packages` | List installed community packages | — | — |
| PATCH | `/community-packages/{name}` | Update a community package | `name` | `object` |
| DELETE | `/community-packages/{name}` | Uninstall a community package | `name` | — |

## `/discover`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| GET | `/discover` | Discover available API capabilities | `include=schemas`, `resource`, `operation` | — |

## `/insights`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| GET | `/insights/summary` | Retrieve insights summary | `startDate`, `endDate`, `projectId` | — |

## `/n8n-packages`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/n8n-packages/export` | Beta: Export workflows, folders, or projects as an n8n package | — | `exportPackageRequest` |
| POST | `/n8n-packages/import` | Beta: Import an n8n package into a project | — | `object` |

## `/role-mapping-rules`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| POST | `/role-mapping-rules` | Create a role-mapping rule | — | `object` |

## `/roles`

| Method | Path | Summary | Query / path params | Body |
|---|---|---|---|---|
| GET | `/roles` | Retrieve all roles | `withUsageCount=true\|false` | — |
| POST | `/roles` | Create a custom role | — | `object` |
| GET | `/roles/{slug}` | Retrieve a role | `slug`, `withUsageCount=true\|false` | — |
| PUT | `/roles/{slug}` | Update a custom role | `slug` | `object` |

---

## Payload shapes that matter

### Workflow

`POST /workflows` and `PUT /workflows/{id}` require **exactly** `name`, `nodes`, `connections`,
`settings`. Everything else the API returns is read-only and causes **HTTP 400** if sent back:

```
id · active · createdAt · updatedAt · isArchived · versionId · triggerCount
meta · tags · shared · activeVersion · homeProject · scopes
```

Optional and accepted: `description`, `staticData`, `pinData`, `nodeGroups`, `parentFolderId`,
and on create only `projectId`. `null` values for these are rejected — omit the key instead.

`workflows update` / `workflows create` in the bundled script strip and validate all of this for
you, so a workflow fetched with `workflows get` can be piped straight back.

```json
{
  "name": "My Workflow",
  "nodes": [
    { "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
      "position": [0, 0], "parameters": { "httpMethod": "POST", "path": "my-hook" } },
    { "name": "Set", "type": "n8n-nodes-base.set", "typeVersion": 3.4,
      "position": [220, 0], "parameters": {} }
  ],
  "connections": { "Webhook": { "main": [[{ "node": "Set", "type": "main", "index": 0 }]] } },
  "settings": { "executionOrder": "v1" }
}
```

- `connections` is keyed by the **source node name**, not its id.
- Node `type` is `n8n-nodes-base.<node>` for built-ins, `@n8n/n8n-nodes-langchain.<node>` for AI nodes.
- Activation is a separate call: `POST /workflows/{id}/activate`. A workflow with no trigger node
  cannot be activated.
- On versioned instances, `PUT` accepts `?publishIfActive=true|false` (default `true`) to control
  whether the edit becomes the live version.

### Credential

`POST /credentials` needs `name`, `type`, `data`. Discover the fields for a type first:

```
GET /credentials/schema/{credentialTypeName}     e.g. slackApi, postgres, httpBasicAuth
```

Secret values are never returned by `GET /credentials/{id}` — only metadata. There is **no
endpoint that lists credential types**; take the type name from a node's `credentials` key
(`workflows nodes <id>` prints them).

### Execution

`GET /executions?includeData=true` inlines the full node I/O and gets big fast. The failure sits at
`data.resultData.error` with the offending node in `data.resultData.lastNodeExecuted`; on some
versions `data` arrives as a JSON **string** that has to be parsed first. `executions errors`
handles both shapes.

---

## Limits and gaps to know about

| Want | Reality |
|---|---|
| Run a workflow on demand | **No API endpoint exists.** Call its Webhook / Form / Chat trigger over plain HTTP (`trigger`), or use `POST /workflows/{id}/test-runs` where evaluations are configured. |
| Webhook URLs | `<base>/webhook/<path>` (production, needs the workflow **active**) and `<base>/webhook-test/<path>` (only while the editor is listening). Forms use `<base>/form/<path>`. |
| Where `<base>` comes from | **Not necessarily the API host.** The host sets the segments with `N8N_ENDPOINT_WEBHOOK` / `N8N_ENDPOINT_WEBHOOK_TEST` (defaults `webhook` / `webhook-test`) and, behind a reverse proxy, the whole base with `N8N_WEBHOOK_URL` (`WEBHOOK_URL` is a deprecated alias since n8n 2.35.0). Override with `--webhook-base`, `--webhook-path`, `--webhook-test-path`; `ping` reports the base in use. |
| Webhook auth | The webhook is **not** authenticated by the API key. Never send `X-N8N-API-KEY` to it; pass whatever the node's own auth expects. |
| List node types | Not in the public API. Read them off existing workflows. |
| Variables, projects, folders, roles, SSO/LDAP settings | Licence-gated. A Community instance answers **403 `Your license does not allow for feat:…`** — not an auth problem. |
| API keys | Created only in the UI (Settings → n8n API), never through the API. Scopes are Enterprise-only; a Community key has full account access. |
| Rate limits | Not documented per-endpoint; 429 carries `Retry-After`. The script backs off and retries automatically. |
| Deleting an execution | Permanent, no undo. Same for workflows — archive first (`workflows archive`) if unsure. |
