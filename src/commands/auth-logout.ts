/**
 * Account-teardown adapters.
 *
 * Two entry points share one cleanup routine:
 *
 *   - `logoutHelloAgent` — `gateway.logoutAccount`, invoked by
 *     `openclaw channels logout --channel helloagent [--account <id>]`.
 *   - `onHelloAgentAccountRemoved` — `lifecycle.onAccountRemoved`, invoked
 *     whenever an account leaves the cfg (per-account removal, or as a
 *     side-effect of `openclaw plugins uninstall helloagent` blowing away
 *     the entire `channels.helloagent` block).
 *
 * Cleanup is best-effort and idempotent: stops the live WS session if any,
 * then deletes the on-disk `creds.json`. Both steps tolerate "already gone".
 */
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";

import { deleteCreds } from "../core/auth-store.js";
import { stopAccount } from "../channel/monitor.js";
import type { ResolvedHelloAgentAccount } from "../core/types.js";

type LogoutAccountFn = NonNullable<
  NonNullable<ChannelPlugin<ResolvedHelloAgentAccount>["gateway"]>["logoutAccount"]
>;
type LogoutCtx = Parameters<LogoutAccountFn>[0];
type LogoutResult = Awaited<ReturnType<LogoutAccountFn>>;

type LifecycleAdapter = NonNullable<ChannelPlugin<ResolvedHelloAgentAccount>["lifecycle"]>;
type OnAccountRemovedFn = NonNullable<LifecycleAdapter["onAccountRemoved"]>;
type OnAccountRemovedParams = Parameters<OnAccountRemovedFn>[0];

async function cleanupAccount(accountId: string, log: (s: string) => void): Promise<void> {
  log(`[helloagent] cleaning up account ${accountId}`);
  await stopAccount(accountId).catch(() => undefined);
  await deleteCreds(accountId).catch(() => undefined);
}

export async function logoutHelloAgent(ctx: LogoutCtx): Promise<LogoutResult> {
  await cleanupAccount(ctx.accountId, (s) => ctx.runtime.log(s));
  return { cleared: true, loggedOut: true };
}

export async function onHelloAgentAccountRemoved(
  params: OnAccountRemovedParams,
): Promise<void> {
  await cleanupAccount(params.accountId, (s) => params.runtime.log(s));
}
