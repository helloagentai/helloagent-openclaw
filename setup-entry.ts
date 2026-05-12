/**
 * Setup-phase entry for OpenClaw's channel installer.
 *
 * Kept intentionally narrow: setup only needs the channel plugin object so
 * OpenClaw can inspect metadata/config without registering CLI commands or
 * daemon gateway methods. The full register() lives in ./index.ts and
 * loads only when the gateway brings the channel up.
 */
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { ensureHelloAgentChannelEnabled } from "./src/core/auto-enable-channel.js";
import { helloAgentPlugin } from "./src/channel/plugin.js";

// Auto-enable the channel on first import so `openclaw channels login
// --channel helloagent` resolves immediately after `plugins install`,
// without forcing the user to run `openclaw config set
// channels.helloagent.enabled true` first. See auto-enable-channel.ts.
ensureHelloAgentChannelEnabled();

export const plugin = helloAgentPlugin;
export default defineSetupPluginEntry(helloAgentPlugin);
