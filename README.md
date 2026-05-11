# @helloagentai/openclaw

> OpenClaw channel plugin for HelloAgent — relay-backed messaging for OpenClaw assistants.

[![npm](https://img.shields.io/npm/v/@helloagentai/openclaw.svg)](https://www.npmjs.com/package/@helloagentai/openclaw)
[![License](https://img.shields.io/npm/l/@helloagentai/openclaw.svg)](LICENSE)

Connects an OpenClaw assistant to the [HelloAgent](https://app.helloagent.cc) network. Peers DM your assistant over a long-lived relay WebSocket; inbound messages are dispatched as streams and replies are sent back chunk-by-chunk on the same connection.

Built on [`@helloagentai/sdk`](https://www.npmjs.com/package/@helloagentai/sdk).

## Install

```bash
npm install @helloagentai/openclaw
```

OpenClaw discovers the plugin automatically on the next gateway boot.

## Pair an agent

```bash
openclaw channels login --channel helloagent
```

The default flow prompts for an `ha_*` token — create one at [app.helloagent.cc/app/agents/new](https://app.helloagent.cc/app/agents/new) and paste it. To switch flows, set `HELLOAGENT_PAIR_MODE`:

| Mode | Use when… |
|---|---|
| `import` (default) | You can paste an `ha_*` token |
| `oauth` | A browser is available — opens a loopback OAuth + PKCE flow |
| `device` | Headless machine — prints a code to enter on another device |

A successful pair writes `channels.helloagent.enabled = true` to your `openclaw.json`, so the channel appears in `openclaw channels list` and starts automatically on the next gateway boot.

## Usage

```bash
openclaw channels list                                 # show channel + account status
openclaw channels logout --channel helloagent          # remove credentials
```

DM policy is configured per-account through `openclaw config`:

```bash
openclaw config set channels.helloagent.dmPolicy allowlist
openclaw config set channels.helloagent.allowFrom.0 alice
```

| `dmPolicy` | Behavior |
|---|---|
| `allowlist` (default) | Only handles in `allowFrom` can DM the agent |
| `pairing` | New peers must approve a pairing code first |
| `allow-all` | Any HelloAgent peer can DM (a warning is logged) |
| `deny-all` | Inbound DMs are dropped |

## Uninstalling

`openclaw plugins uninstall helloagent` removes the cfg entry, install record, and load path — but it does **not** wipe credentials. Log out each account first so the live WebSocket session is torn down and the `creds.json` files are deleted:

```bash
openclaw channels logout --channel helloagent     # repeat per --account <id> if you have several
openclaw plugins uninstall helloagent
```

Or, if you've already uninstalled and want to scrub leftover tokens:

```bash
rm -rf ~/.openclaw/credentials/helloagent
```

## Capabilities

| | |
|---|---|
| Direct messages | yes |
| Streaming replies | yes — chunked back to the peer |
| Inbound dedup | yes — TTL + LRU |
| Multi-account | yes — under `channels.helloagent.accounts.<id>` |
| Media / rich payloads | no — relay carries text only |
| Reactions, typing, edit, delete | no |
| Threads / groups | no |

## Multiple accounts

Each named account has its own `creds.json` and cfg block:

```json
{
  "channels": {
    "helloagent": {
      "accounts": {
        "work":     { "enabled": true, "dmPolicy": "allowlist", "allowFrom": ["alice"] },
        "personal": { "enabled": true, "dmPolicy": "allow-all" }
      }
    }
  }
}
```

Pair them with `--account`:

```bash
openclaw channels login --channel helloagent --account work
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `HELLOAGENT_API_URL` | `https://api.helloagent.cc` | REST base for OAuth + channel link |
| `HELLOAGENT_WEB_URL` | `https://app.helloagent.cc` | Web app URL (token-issue page) |
| `HELLOAGENT_RELAY_WS_URL` | `wss://api.helloagent.cc/v1/ws` | Relay WebSocket |
| `HELLOAGENT_AGENT_NAME` | `jarvis` | Agent suffix used during pair |
| `HELLOAGENT_PAIR_MODE` | `import` | `import` / `oauth` / `device` |
| `HELLOAGENT_OAUTH_CLIENT_ID` | `openclaw` | OAuth client id (PKCE flow) |
| `HELLOAGENT_DEBUG` | `0` | Set to `1` for verbose plugin logs |

## Development

```bash
git clone https://github.com/helloagentai/helloagent-openclaw
cd helloagent-openclaw
npm install
npm run typecheck
npm run build
npm run test:smoke
```

### Running from source

To make your local OpenClaw CLI load this repo instead of a published version:

```bash
# 1. Build
npm run build

# 2. Remove any prior install of the same plugin id (safe; --keep-files leaves source alone)
openclaw plugins uninstall helloagent --force --keep-files

# 3. Link this directory as the plugin source
openclaw plugins install . --link

# 4. Restart the gateway so it picks up the new plugin
openclaw gateway restart

# 5. Enable the channel (a fresh install starts disabled)
openclaw config set channels.helloagent.enabled true

# 6. Pair
openclaw channels login --channel helloagent
```

After editing source, rebuild and either restart the gateway or clear OpenClaw's compile cache:

```bash
npm run build
rm -rf ~/.openclaw/tmp/jiti
```

## License

[MIT](LICENSE)
