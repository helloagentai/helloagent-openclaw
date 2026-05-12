/**
 * OpenClaw HelloAgent channel plugin entry point.
 *
 * Uses `defineChannelPluginEntry` so the gateway's plugin loader recognises
 * us as a channel plugin (not a generic register-only plugin) and brings the
 * channel up at boot. The hand-rolled `register(api)` shape was rejected by
 * the gateway loader at boot time (silent skip — visible only as helloagent
 * absent from the "http server listening (N plugins: …)" log line).
 *
 * registerFull installs the auto-teardown listener that tears down a live WS
 * if its creds.json disappears out-of-band.
 */
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

import * as accountCache from "./src/core/account-cache.js";
import { stopAccount } from "./src/channel/monitor.js";
import { helloAgentPlugin } from "./src/channel/plugin.js";
import { ensureHelloAgentChannelEnabled } from "./src/core/auto-enable-channel.js";
import { haLogger } from "./src/core/ha-logger.js";

// See setup-entry.ts: same side effect, mirrored here so that whichever
// entry openclaw imports first auto-enables the channel.
ensureHelloAgentChannelEnabled();

const log = haLogger("plugin");

function wireAutoTeardownOnCredsRemoval(): void {
  accountCache.init();
  accountCache.onChange((event, accountId) => {
    if (event !== "removed") return;
    log.info(`creds removed for ${accountId}; stopping live session`);
    void stopAccount(accountId).catch(() => {
      // stopAccount is best-effort; a missing session is already a no-op.
    });
  });
}

const entry = defineChannelPluginEntry({
  id: "helloagent",
  name: "HelloAgent",
  description: "HelloAgent channel plugin (relay-backed messaging)",
  plugin: helloAgentPlugin,
  registerFull: (_api) => {
    wireAutoTeardownOnCredsRemoval();
  },
});

// Re-export every name the gateway loader's plugin-shape scan checks for.
export const register: (api: Parameters<typeof entry.register>[0]) => void = entry.register;
export const id = entry.id;
export const name = entry.name;
export const description = entry.description;
export const configSchema = entry.configSchema;
export const channelPlugin = entry.channelPlugin;
export default entry;

// Re-export the channel plugin itself so external embedders / tests can
// reach it without going through the channel-loader.
export { helloAgentPlugin } from "./src/channel/plugin.js";

// Re-export the auth-presence probe registered in package.json's
// `openclaw.channel.persistedAuthState`.
export { hasAnyHelloAgentAuth } from "./src/auth/presence.js";

// Re-export pairing helpers so embedders can drive flows without reaching
// into deep paths.
export { pairHelloAgent } from "./src/auth/login.js";
export type { PairOptions } from "./src/auth/login.js";
export { pairHelloAgentWithDeviceCode } from "./src/auth/login-device.js";
export type { DevicePairOptions } from "./src/auth/login-device.js";
export { importHelloAgentToken } from "./src/auth/import-token.js";
export type { ImportTokenOptions } from "./src/auth/import-token.js";
export {
  deleteCreds,
  listLinkedAccountIds,
  readCreds,
  writeCreds,
  type HelloAgentCreds,
} from "./src/core/auth-store.js";
