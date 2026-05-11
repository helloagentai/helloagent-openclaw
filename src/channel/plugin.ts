/**
 * ChannelPlugin<ResolvedHelloAgentAccount> — the top-level entry the OpenClaw
 * plugin system uses to discover capabilities, resolve accounts, obtain
 * outbound adapters, and start the inbound gateway.
 *
 * This is intentionally a plain literal (no `createChatChannelPlugin` wrapper)
 * so we can populate the richer surfaces — `security`, `pairing`, `status`,
 * `reload`, `agentPrompt`, `messaging` — that the wrapper hides.
 *
 * Adapters wired here:
 *
 *   meta            label / blurb / docs
 *   capabilities    chatTypes (direct only); media/reactions/threads = false
 *   reload          configPrefixes for hot reload
 *   agentPrompt     message-tool hints for HelloAgent handle conventions
 *   pairing         pairing-code DM flow (notify via outbound send)
 *   security        DM policy + collectWarnings
 *   config          listAccountIds / resolveAccount / inspectAccount /
 *                   isEnabled / isConfigured / setAccountEnabled / resolveAllowFrom
 *   setup           applyAccountConfig (sets enabled=true on link)
 *   messaging       normalizeTarget for HelloAgent handles
 *   threading       topLevelReplyToMode = "reply"
 *   outbound        sendText (via messaging/outbound/outbound.ts)
 *   status          defaultRuntime + buildAccountSnapshot + probeAccount
 *   gateway         startAccount / stopAccount / logoutAccount
 *   auth            login (delegates to commands/auth-login.ts)
 */
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";

import * as accountCache from "../core/account-cache.js";
import { getAccount, listAccountIds } from "../core/accounts.js";
import type { HelloAgentAccount, ResolvedHelloAgentAccount } from "../core/types.js";
import { sendText } from "../messaging/outbound/send.js";
import { helloAgentOutbound } from "../messaging/outbound/outbound.js";
import { loginHelloAgent } from "../commands/auth-login.js";
import { logoutHelloAgent, onHelloAgentAccountRemoved } from "../commands/auth-logout.js";
import {
  applyAccountConfig,
  collectHelloAgentSecurityWarnings,
  deleteAccount,
  setAccountEnabled,
} from "./config-adapter.js";
import { probeHelloAgent } from "./probe.js";
import { startAccount, stopAccount } from "./monitor.js";

const CHANNEL_ID = "helloagent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseHelloAgentHandle(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function looksLikeHelloAgentHandle(value: string): boolean {
  // Handle shape: <user> or <user>/<agent>. Letters, digits, dot, dash, underscore.
  return /^@?[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(value);
}

// ---------------------------------------------------------------------------
// Channel plugin literal
// ---------------------------------------------------------------------------

export const helloAgentPlugin: ChannelPlugin<ResolvedHelloAgentAccount> = {
  id: CHANNEL_ID,

  meta: {
    id: CHANNEL_ID,
    label: "HelloAgent",
    selectionLabel: "HelloAgent (relay)",
    detailLabel: "HelloAgent relay",
    docsPath: "/channels/helloagent",
    docsLabel: "helloagent",
    blurb: "Receive and reply to HelloAgent network messages from your assistant.",
  },

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  // The gateway boot loader uses `conversationBindings` as the marker that
  // identifies an "active chat channel" plugin worth bringing up; without it
  // the plugin is silently skipped at boot (visible only as the channel
  // missing from the "http server listening (N plugins: …)" line). The
  // `createChatChannelPlugin` wrapper sets this automatically; since we use
  // a plain literal we have to set it explicitly. See
  // node_modules/openclaw/dist/core-*.js → createChatChannelPlugin().
  conversationBindings: {
    supportsCurrentConversationBinding: true,
  },

  // -------------------------------------------------------------------------
  // Reload — restart on config changes under this prefix.
  // -------------------------------------------------------------------------

  reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },

  // -------------------------------------------------------------------------
  // Agent prompt — teach the agent how HelloAgent handles look.
  // -------------------------------------------------------------------------

  agentPrompt: {
    messageToolHints: () => [
      "- HelloAgent targeting: `to` is a peer handle. Direct user: `alice`. Specific agent: `alice/jarvis`. Leading `@` is tolerated.",
      "- HelloAgent supports plain text only; cards, media, and reactions are not delivered (yet).",
      "- Replies are streamed: prefer short paragraphs separated by blank lines so each chunk sends incrementally.",
    ],
  },

  // -------------------------------------------------------------------------
  // Pairing — the pairing-code DM flow.
  // -------------------------------------------------------------------------

  pairing: {
    idLabel: "HelloAgent handle",
    normalizeAllowEntry: (entry) => normaliseHelloAgentHandle(entry) ?? entry,
    notifyApproval: async ({ cfg, id }) => {
      const account = getAccount(cfg, undefined);
      if (!account.resolved) {
        // Pairing approval can only be delivered if we have an account live.
        // Silently no-op rather than throw — the pairing UX still completes.
        return;
      }
      const recipient = normaliseHelloAgentHandle(id);
      if (!recipient) return;
      const result = sendText({
        accountId: account.accountId,
        toHandle: recipient,
        text: "[HelloAgent] Pairing approved. You can now message this assistant.",
      });
      if (!result.delivered) {
        // Tolerate failure — the host still records the approval.
        // The outbound adapter logs the reason itself.
      }
    },
  },

  // -------------------------------------------------------------------------
  // Security — DM policy + warnings.
  // -------------------------------------------------------------------------

  security: {
    collectWarnings: ({ cfg, accountId }) =>
      collectHelloAgentSecurityWarnings({ cfg, accountId: accountId ?? "default" }),
  },

  // -------------------------------------------------------------------------
  // Config schema (JSON Schema) — for openclaw config validation.
  // -------------------------------------------------------------------------

  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        name: { type: "string" },
        apiUrl: { type: "string", format: "uri" },
        relayWs: { type: "string", format: "uri" },
        allowFrom: {
          type: "array",
          items: { type: "string" },
        },
        dmPolicy: {
          type: "string",
          enum: ["allowlist", "allow-all", "deny-all", "pairing"],
        },
        accounts: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            properties: {
              enabled: { type: "boolean" },
              name: { type: "string" },
              apiUrl: { type: "string", format: "uri" },
              relayWs: { type: "string", format: "uri" },
              allowFrom: {
                type: "array",
                items: { type: "string" },
              },
              dmPolicy: {
                type: "string",
                enum: ["allowlist", "allow-all", "deny-all", "pairing"],
              },
            },
          },
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Config adapter — account list/resolve.
  //
  // Note: the host's adapter signatures expect a `ResolvedHelloAgentAccount`
  // from `resolveAccount`, so we throw when an entry is referenced but not
  // paired. The richer `HelloAgentAccount` view (with `enabled`, `configured`,
  // `name`) is exposed via `inspectAccount` for status panels.
  // -------------------------------------------------------------------------

  config: {
    listAccountIds: (cfg) => listAccountIds(cfg),

    resolveAccount: (cfg, accountId) => {
      const view: HelloAgentAccount = getAccount(cfg, accountId);
      // Order matters: pairing is the more specific & actionable hint.
      // Without creds on disk, "disabled" would be misleading — the user
      // hasn't even told us *what* to enable yet.
      if (!view.configured || !view.resolved) {
        throw new Error(
          `helloagent: account ${view.accountId} is not paired. ` +
            `Run \`openclaw channels login --channel helloagent\` first.`,
        );
      }
      if (!view.enabled) {
        throw new Error(
          `helloagent: account ${view.accountId} is disabled in OpenClaw config. ` +
            `Set channels.helloagent.enabled to true (or remove the override).`,
        );
      }
      return view.resolved;
    },

    inspectAccount: (cfg, accountId) => {
      const view = getAccount(cfg, accountId);
      return {
        accountId: view.accountId,
        channelId: CHANNEL_ID,
        enabled: view.enabled,
        configured: view.configured,
        state: view.configured
          ? view.enabled
            ? "linked"
            : "disabled"
          : "not_paired",
        name: view.name,
        handle: view.resolved?.handle,
        apiUrl: view.resolved?.apiUrl ?? view.config.apiUrl,
        relayWs: view.resolved?.relayWs ? "configured" : "default",
        dmPolicy: view.config.dmPolicy ?? "allowlist",
        allowFromCount: (view.config.allowFrom ?? []).length,
      };
    },

    defaultAccountId: () => "default",

    isEnabled: (_account, cfg) => {
      // The account argument is the resolved (non-null) shape; we re-read cfg
      // for the explicit override since pairing on disk doesn't imply
      // "enabled" by itself.
      const view = getAccount(cfg, _account?.accountId ?? "default");
      return view.enabled;
    },

    disabledReason: () => "HelloAgent channel is disabled in OpenClaw config.",

    isConfigured: (account) => Boolean(account?.token),

    unconfiguredReason: () =>
      "Run `openclaw channels login --channel helloagent` to link this OpenClaw assistant to HelloAgent.",

    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabled(cfg, accountId, enabled),

    deleteAccount: ({ cfg, accountId }) => deleteAccount(cfg, accountId),

    resolveAllowFrom: ({ cfg, accountId }) => {
      const view = getAccount(cfg, accountId);
      return (view.config.allowFrom ?? []).map((entry) => String(entry).trim()).filter(Boolean);
    },

    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => (entry.startsWith("@") ? entry.slice(1) : entry)),
  },

  // -------------------------------------------------------------------------
  // Setup — applied on pairing success.
  // -------------------------------------------------------------------------

  setup: {
    applyAccountConfig: ({ cfg, accountId }) =>
      applyAccountConfig(cfg, accountId ?? "default", { enabled: true }),
  },

  // -------------------------------------------------------------------------
  // Messaging — handle/target shape.
  // -------------------------------------------------------------------------

  messaging: {
    normalizeTarget: (raw) => normaliseHelloAgentHandle(raw),
    targetResolver: {
      looksLikeId: looksLikeHelloAgentHandle,
      hint: "<user> or <user>/<agent>",
    },
  },

  // -------------------------------------------------------------------------
  // Threading — reply to the message that triggered the turn so the peer's
  // UI threads the response under the inbound.
  // -------------------------------------------------------------------------

  threading: {
    resolveReplyToMode: () => "first",
  },

  // -------------------------------------------------------------------------
  // Outbound — sendText. sendMedia/sendPayload throw (relay does not carry
  // media or rich payloads).
  // -------------------------------------------------------------------------

  outbound: helloAgentOutbound,

  // -------------------------------------------------------------------------
  // Status — defaultRuntime + snapshot builders + probe.
  // -------------------------------------------------------------------------

  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      port: null,
    },

    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      port: snapshot.port ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),

    probeAccount: async ({ account }) => probeHelloAgent(account),

    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      configured: true,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
      handle: account.handle,
      probe,
    }),
  },

  // -------------------------------------------------------------------------
  // Gateway — start / stop / logoutAccount.
  // -------------------------------------------------------------------------

  gateway: {
    startAccount: async (ctx) => startAccount(ctx),
    stopAccount: async (ctx) => {
      ctx.log?.info?.(`helloagent: stopping ${ctx.accountId}`);
      await stopAccount(ctx.accountId);
    },
    logoutAccount: logoutHelloAgent,
  },

  // -------------------------------------------------------------------------
  // Lifecycle — react to account removal from cfg (covers `channels logout`
  // and the cascade from `plugins uninstall helloagent`). Deletes the
  // on-disk creds so sensitive ha_* tokens don't outlive the install.
  // -------------------------------------------------------------------------

  lifecycle: {
    onAccountRemoved: onHelloAgentAccountRemoved,
  },

  // -------------------------------------------------------------------------
  // Auth — channels login dispatch (oauth/device/import).
  // -------------------------------------------------------------------------

  auth: {
    login: loginHelloAgent,
  },
};

// Re-export for the auto-teardown wiring in index.ts.
export { accountCache };
