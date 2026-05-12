/**
 * Ensure `cfg.channels.helloagent` exists in the user's openclaw config so
 * that `openclaw channels login --channel helloagent` resolves the channel
 * via OpenClaw's "configured-channels" plugin loader scope.
 *
 * Background: OpenClaw's CLI channel resolver only auto-loads plugins whose
 * channel id is either (a) in the bundled official catalog, (b) in a local
 * external catalog file, or (c) referenced under `cfg.channels.<id>` (the
 * "configured-channels" scope). HelloAgent is third-party so it isn't in
 * the bundled catalog; without (c) the resolver throws "Unsupported channel:
 * helloagent" before our plugin code ever runs.
 *
 * This helper runs as an import-time side effect from `setup-entry.ts` and
 * `index.ts`. OpenClaw imports `setup-entry` early in its plugin
 * auto-enable scan, which gives us a chance to:
 *
 *   1. Persist `cfg.channels.helloagent.enabled = true` to disk so all
 *      subsequent invocations resolve cleanly. Idempotent and respects an
 *      existing `enabled: false` (user opt-out).
 *   2. Mutate the in-memory runtime config snapshot used by the current
 *      invocation, so the very first `channels login` after `plugins
 *      install` succeeds without forcing the user to retry.
 *
 * Both steps are best-effort: any error is swallowed so import never throws.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHANNEL_ID = "helloagent";

function resolveCfgPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OPENCLAW_CONFIG_PATH?.trim();
  if (explicit) return explicit;
  const stateDir = env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "openclaw.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Returns true iff cfg already records an explicit decision for our channel
 * (enabled or disabled). We never overwrite a user's explicit setting.
 */
function channelAlreadyDecided(cfg: Record<string, unknown>): boolean {
  const channels = isPlainObject(cfg.channels) ? cfg.channels : null;
  if (!channels) return false;
  const entry = channels[CHANNEL_ID];
  if (!isPlainObject(entry)) return false;
  return Object.prototype.hasOwnProperty.call(entry, "enabled");
}

function patchCfgInPlace(cfg: Record<string, unknown>): void {
  const channels = isPlainObject(cfg.channels) ? { ...cfg.channels } : {};
  const existing = isPlainObject(channels[CHANNEL_ID]) ? channels[CHANNEL_ID] : {};
  channels[CHANNEL_ID] = { ...existing, enabled: true };
  cfg.channels = channels;
}

function patchOnDiskCfg(): void {
  const cfgPath = resolveCfgPath();
  let raw = "";
  try {
    raw = fs.readFileSync(cfgPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
  let cfg: Record<string, unknown>;
  try {
    cfg = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // Corrupt cfg: don't touch it.
    return;
  }
  if (channelAlreadyDecided(cfg)) return;
  patchCfgInPlace(cfg);
  try {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    if (raw) {
      try {
        fs.writeFileSync(`${cfgPath}.bak`, raw);
      } catch {
        // Backup failure shouldn't block the patch.
      }
    }
    const tmp = `${cfgPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
    fs.renameSync(tmp, cfgPath);
  } catch {
    // Disk write failure: in-memory patch (below) may still recover this run.
  }
}

/**
 * Mutate the in-memory runtime config snapshot. Required because openclaw's
 * channel-login flow reads the config once at the start of the command via
 * `getRuntimeConfig()` and never re-reads from disk; without this, the disk
 * patch above would only take effect on the *next* invocation.
 *
 * Uses dynamic `createRequire` so import failure (e.g. on an older openclaw
 * that doesn't export this SDK surface) doesn't break the plugin.
 */
function patchInMemoryCfg(): void {
  let getRuntimeConfig: (() => Record<string, unknown> | null | undefined) | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require("node:module") as typeof import("node:module");
    const requireFromHere = createRequire(import.meta.url);
    const mod = requireFromHere("openclaw/plugin-sdk/runtime-config-snapshot") as {
      getRuntimeConfig?: () => Record<string, unknown> | null | undefined;
    };
    getRuntimeConfig = mod.getRuntimeConfig;
  } catch {
    return;
  }
  const cfg = getRuntimeConfig?.();
  if (!cfg || !isPlainObject(cfg)) return;
  if (channelAlreadyDecided(cfg)) return;
  patchCfgInPlace(cfg);
}

let attempted = false;
export function ensureHelloAgentChannelEnabled(): void {
  if (attempted) return;
  attempted = true;
  try {
    patchOnDiskCfg();
  } catch {
    // ignore
  }
  try {
    patchInMemoryCfg();
  } catch {
    // ignore
  }
}

/**
 * Internals exposed for the smoke test (tests/smoke.ts). Not part of the
 * public API — do not import from outside this package.
 *
 * @internal
 */
export const __testing = {
  channelAlreadyDecided,
  patchCfgInPlace,
  resolveCfgPath,
  resetAttempted(): void {
    attempted = false;
  },
};
