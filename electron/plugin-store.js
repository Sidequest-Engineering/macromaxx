import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PluginStore, TrustedRegistry } from '@macromaxx/plugin-runtime';
import { hasMissingCredentials } from '../shared/workspace-credentials.js';

export function parseStoreReference(reference) {
  if (typeof reference !== 'string' || !reference.startsWith('store:')) return null;
  const match = /^store:([a-z][a-z0-9-]{0,47}--[a-z][a-z0-9-]{0,47}):([a-z][a-z0-9-]{0,47})$/.exec(reference);
  if (!match) throw new Error('Invalid store action reference.');
  return { id: match[1], actionId: match[2] };
}

export function mergePluginStatus(native = {}, visuals = {}, store = {}) {
  return { ...native, native: { ...native.native, visuals: { ...native.native?.visuals, ...visuals } }, pluginStore: store };
}

export function dispatchPluginKeyEvent(store, key, event, report) {
  if (hasMissingCredentials(key?.actions?.[0])) return;
  // Call now so the runtime queue sees keyUp before the chain's execute event.
  try { Promise.resolve(store.keyEvent(key, event)).catch(report); }
  catch (error) { report(error); }
}

export function storeDataDirectory(userData, config = {}) {
  if (config.enabled !== true) return path.join(userData, 'plugin-stores', 'disabled');
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const authority = JSON.stringify(canonical({ root: config.root, metadataUrl: config.metadataUrl, targetsUrl: config.targetsUrl }));
  return path.join(userData, 'plugin-stores', createHash('sha256').update(authority).digest('hex'));
}

export async function createPluginStore({ app, dialog, getWindow, getState, changed, report }) {
  let directory = storeDataDirectory(app.getPath('userData'));
  const patches = new Map();
  let registry, configError, channel, disabledReason;
  try {
    const configPath = !app.isPackaged && process.env.MACROMAXX_STORE_CONFIG || path.join(app.getAppPath(), 'electron/plugin-store-config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (config.enabled !== true && typeof config.reason === 'string' && config.reason.length <= 240) disabledReason = config.reason;
    if (config.enabled === true) {
      directory = storeDataDirectory(app.getPath('userData'), config);
      channel = config.channel === 'test' ? 'test' : 'production';
      registry = new TrustedRegistry({ directory: path.join(directory, 'metadata'), metadataUrl: config.metadataUrl, targetsUrl: config.targetsUrl, root: config.root, allowLoopback: !app.isPackaged && config.allowLoopback === true });
    }
  } catch (error) { configError = 'Store configuration invalid: ' + error.message; report(error); }
  const store = new PluginStore({
    directory, registry, appVersion: app.getVersion(), changed,
    onDisplay(id, keyId, patch) {
      if (keyId === null) { patches.delete(id); }
      else { if (!patches.has(id)) patches.set(id, new Map()); patches.get(id).set(keyId, patch); }
      changed();
    },
  });
  try { await store.init(); }
  catch (error) { configError = 'Local plugin store unavailable: ' + error.message; store.close(); report(error); }
  const snapshot = () => ({ ...store.snapshot(), channel, disabledReason, ...(configError ? { error: configError } : {}) });
  const renderKey = key => {
    if (!key) return key;
    let patch;
    for (const action of [...(key.actions || []), ...(key.longActions || [])]) {
      let ref;
      try { ref = action.type === 'plugin' ? parseStoreReference(action.pluginId) : null; } catch { continue; }
      if (ref && patches.get(ref.id)?.has(key.id)) patch = { ...patch, ...patches.get(ref.id).get(key.id) };
    }
    return patch ? { ...key, ...patch } : key;
  };
  const visuals = () => {
    const result = {};
    const visit = keys => { for (const key of keys || []) if (key) { const live = renderKey(key); if (live !== key) result[key.id] = { label: live.label, color: live.color }; visit(key.children); } };
    getState().profiles.forEach(profile => visit(profile.keys)); return result;
  };
  const actions = () => {
    const state = store.snapshot();
    return state.installed.flatMap(record => {
      const release = state.releases.find(r => r.manifest.id === record.id && r.manifest.version === record.version);
      return release?.manifest.actions.map(action => ({ id: `store:${record.id}:${action.id}`, name: `${release.manifest.name}: ${action.name}`, description: release.manifest.description, fields: action.fields || [], storePlugin: true })) || [];
    });
  };
  const execute = (reference, config, signal, context = {}) => {
    const ref = parseStoreReference(reference);
    if (!ref) throw new Error('Not a store plugin.');
    return store.execute(ref.id, ref.actionId, { config, ...context }, signal);
  };
  const keyEvent = (key, event) => {
    const action = key?.actions?.[0];
    if (hasMissingCredentials(action)) return;
    const ref = parseStoreReference(action?.pluginId);
    if (!ref) return;
    return store.execute(ref.id, ref.actionId, { keyId: key.id, config: JSON.parse(action.config || '{}') }, undefined, event);
  };
  const handlers = {
    storeSnapshot: snapshot,
    storeRefresh: async () => { await store.refresh(); await store.updateAutomatic(); return snapshot(); },
    storeInstall: async (_, id, version) => {
      if (typeof id !== 'string' || typeof version !== 'string') throw new Error('Invalid plugin version.');
      const release = store.release(id, version);
      const result = await dialog.showMessageBox(getWindow(), { type: 'warning', title: 'Install plugin', message: `Install ${release.manifest.name} ${version}?`, detail: `Publisher: ${release.manifest.publisher}\n\nPermissions:\n${release.manifest.permissions.join('\n') || 'None'}\n\nRuns in a restricted JavaScript engine. Store approval and integrity checks do not prove the code is harmless. Settings are local, unencrypted and separate from workspace exports.`, buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0 });
      if (result.response !== 1) return snapshot();
      await store.install(id, version, release.manifest.permissions, release.sha256); return snapshot();
    },
    storeEnable: async (_, id, enabled) => { await store.setEnabled(id, enabled); return snapshot(); },
    storeAutoUpdate: async (_, id, enabled) => { await store.setAutoUpdate(id, enabled); return snapshot(); },
    storeUninstall: async (_, id) => {
      const result = await dialog.showMessageBox(getWindow(), { type: 'warning', message: 'Uninstall this plugin?', detail: 'Its settings are removed. Existing key assignments remain but cannot execute until the plugin is installed again.', buttons: ['Cancel', 'Uninstall'], defaultId: 0, cancelId: 0 });
      if (result.response === 1) await store.uninstall(id); return snapshot();
    },
  };
  // Refresh while hidden too; no background update may add permissions.
  const timer = registry && setInterval(() => handlers.storeRefresh().catch(report), 6 * 60 * 60 * 1000);
  timer?.unref();
  return { snapshot, handlers, actions, execute, keyEvent, renderKey, visuals, cancel: () => store.cancel(), close: () => { clearInterval(timer); store.close(); } };
}
