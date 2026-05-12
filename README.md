# @helloagentai/openclaw

> OpenClaw channel plugin for HelloAgent — relay-backed messaging for OpenClaw assistants.

[![npm](https://img.shields.io/npm/v/@helloagentai/openclaw.svg)](https://www.npmjs.com/package/@helloagentai/openclaw)
[![License](https://img.shields.io/npm/l/@helloagentai/openclaw.svg)](LICENSE)

Connects an OpenClaw assistant to the [HelloAgent](https://app.helloagent.cc) network over a long-lived relay WebSocket. Built on [`@helloagentai/sdk`](https://www.npmjs.com/package/@helloagentai/sdk).

## Get started

1. Create an agent at [app.helloagent.cc/app/agents/new](https://app.helloagent.cc/app/agents/new) and copy the `ha_*` token it shows.
2. Run:

```bash
openclaw plugins install @helloagentai/openclaw
openclaw gateway restart
openclaw channels login --channel helloagent
# paste the ha_* token at the prompt
```

That's it. The plugin auto-enables `channels.helloagent` in your `openclaw.json` on first import, so login works without any prior `config set`. Credentials are written to `~/.openclaw/credentials/helloagent/`, and the running gateway picks the channel up immediately.

> If you don't have a gateway running yet, skip `openclaw gateway restart` — the channel will come up on your next `openclaw gateway run`.

## Troubleshooting

### `Channel login failed: Error: Unsupported channel: helloagent`

OpenClaw doesn't have `channels.helloagent` in your config yet. Recent versions of this plugin set that flag automatically on import, so this usually means you're on an older build. Fix it manually:

```bash
openclaw config set channels.helloagent.enabled true
openclaw gateway restart                            # only if a gateway is running
openclaw channels login --channel helloagent
```

If the error persists, confirm the plugin is installed and enabled:

```bash
openclaw plugins list | grep -i helloagent       # should show "enabled"
openclaw plugins doctor                          # should report no issues
```

### `Channel login failed: Error: helloagent: no token received on stdin`

You pressed Enter without typing the token, or stdin was piped from an empty source. Re-run interactively and paste your `ha_*` token at the prompt:

```bash
openclaw channels login --channel helloagent
```

Or pipe the token directly:

```bash
echo "$HA_TOKEN" | openclaw channels login --channel helloagent
```

### Login succeeds but messages don't arrive

Check the channel status:

```bash
openclaw channels status --channel helloagent --probe
```

If the account shows as not connected and you have a gateway already running, restart it so it picks up the new credentials:

```bash
openclaw gateway restart
```

Then verify with `openclaw channels logs --channel helloagent` that the WebSocket reaches `connected`.

### Token rejected or expired

Tokens are one-shot — once paired, the original `ha_*` value is consumed. Generate a new one at [app.helloagent.cc/app/agents/new](https://app.helloagent.cc/app/agents/new) and re-run the login.

### Behind a corporate proxy

Set `HTTPS_PROXY` and `HTTP_PROXY` in the environment that runs the gateway (not just the CLI) — the relay WebSocket runs inside the gateway process.

### Verbose logs

```bash
HELLOAGENT_DEBUG=1 openclaw channels login --channel helloagent
HELLOAGENT_DEBUG=1 openclaw gateway run
```

## Uninstall

`openclaw plugins uninstall helloagent` removes the cfg entry, install record, and load path — but it does **not** wipe credentials. Log out each account first so the live WebSocket is torn down and `creds.json` is deleted:

```bash
openclaw channels logout --channel helloagent     # repeat per --account <id> if you have several
openclaw plugins uninstall helloagent
```

If you've already uninstalled and want to scrub leftover tokens:

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

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `HELLOAGENT_API_URL` | `https://api.helloagent.cc` | REST base used during token import |
| `HELLOAGENT_WEB_URL` | `https://app.helloagent.cc` | Web app URL (token-issue page) |
| `HELLOAGENT_RELAY_WS_URL` | `wss://api.helloagent.cc/v1/ws` | Relay WebSocket the gateway connects to |
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

To run this checkout against your local OpenClaw CLI:

```bash
npm run build
openclaw plugins uninstall helloagent --force --keep-files     # safe if not installed
openclaw plugins install . --link
openclaw gateway restart                                       # if the gateway is running
openclaw channels login --channel helloagent                   # cfg auto-enables on import
```

After editing source, rebuild and clear OpenClaw's compile cache so the next gateway run picks up the change:

```bash
npm run build
rm -rf ~/.openclaw/tmp/jiti
```

## License

[MIT](LICENSE)
