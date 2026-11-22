import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../icons.jsx';
import { pluginStoreStatus } from '../../../shared/plugin-store-status.js';

const permissionLabels = {
  'display:write': 'Update assigned key displays',
  'settings:read': 'Read this plugin’s settings',
  'settings:write': 'Save this plugin’s settings',
};

export function PluginStorePanel({ status, refreshPlugins }) {
  const [data, setData] = useState(status.pluginStore || null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (status.pluginStore) setData(status.pluginStore);
  }, [status.pluginStore]);
  useEffect(() => {
    let disposed = false;
    api
      .storeSnapshot()
      .then((value) => {
        if (!disposed) setData(value);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const run = async (operation) => {
    setBusy(true);
    setError('');
    try {
      setData(await operation());
      await refreshPlugins();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const latest = new Map();
  for (const release of [...(data?.releases || [])].sort((a, b) =>
    b.manifest.version.localeCompare(a.manifest.version, undefined, { numeric: true }),
  )) {
    if (release.status === 'approved' && !latest.has(release.manifest.id))
      latest.set(release.manifest.id, release);
  }
  // Keep revoked/withdrawn installations visible so they can be removed.
  for (const installed of data?.installed || [])
    if (!latest.has(installed.id)) {
      const release = data.releases.find(
        (r) => r.manifest.id === installed.id && r.manifest.version === installed.version,
      );
      latest.set(
        installed.id,
        release || {
          manifest: {
            id: installed.id,
            name: installed.id,
            version: installed.version,
            permissions: installed.permissions,
            description: 'Refresh the store to verify this installation.',
            publisher: 'Unknown',
            platforms: [],
          },
          status: 'unverified',
        },
      );
    }
  const items = [...latest.values()].filter(
    ({ manifest }) =>
      (filter !== 'installed' || data?.installed.some((p) => p.id === manifest.id)) &&
      `${manifest.name} ${manifest.description} ${manifest.publisher}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const detail = latest.get(selected);
  const installedFor = (id) => data?.installed.find((p) => p.id === id);
  const catalogStatus = pluginStoreStatus(data || {});
  const controls = (release) => {
    const installed = installedFor(release.manifest.id);
    const update = installed?.update;
    return (
      <div className="tool-row">
        {!installed ? (
          <button
            className="button primary"
            disabled={busy || !data?.trusted || release.status !== 'approved'}
            onClick={() =>
              run(() => api.storeInstall(release.manifest.id, release.manifest.version))
            }
          >
            Install
          </button>
        ) : (
          <>
            {update && (
              <button
                className="button primary"
                disabled={busy || !data?.trusted}
                onClick={() => run(() => api.storeInstall(installed.id, update.manifest.version))}
              >
                {installed.requiresConsent
                  ? 'Review update permissions'
                  : `Update to ${update.manifest.version}`}
              </button>
            )}
            <button
              className="button"
              disabled={
                busy || (!installed.enabled && !data?.trusted) || release.status === 'revoked'
              }
              onClick={() => run(() => api.storeEnable(installed.id, !installed.enabled))}
            >
              {installed.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => run(() => api.storeUninstall(installed.id))}
            >
              Uninstall
            </button>
          </>
        )}
      </div>
    );
  };
  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Plugin store</h1>
          <p>Discover reviewed releases. Keep control of what runs.</p>
        </div>
        <button
          className="button"
          disabled={busy || !data?.configured}
          onClick={() => run(() => api.storeRefresh())}
        >
          <Icon name="RefreshCw" size={16} />
          {busy ? 'Working …' : 'Check for updates'}
        </button>
      </section>
      {(error || data?.error) && (
        <div className="notice" role="alert">
          {error || data.error}
        </div>
      )}
      {!data ? (
        <p role="status">Loading plugin store …</p>
      ) : !data.configured ? (
        <section className="settings-card store-trust">
          <Icon name="ShieldCheck" size={30} />
          <div>
            <h2>{catalogStatus.title}</h2>
            <p>{catalogStatus.message}</p>
            <small>
              No third-party code has been downloaded. Local legacy plugins remain under
              Integrations.
            </small>
          </div>
        </section>
      ) : (
        <>
          {!data.trusted && (
            <div className="notice" role="status">
              <strong>{catalogStatus.title}</strong> {catalogStatus.message}
            </div>
          )}
          {detail ? (
            <div className="plugin-details">
              <button className="button" onClick={() => setSelected(null)}>
                <Icon name="ArrowLeft" size={16} />
                All store plugins
              </button>
              <section className="settings-card">
                <div className="settings-title">
                  <span className="action-icon">
                    <Icon name="Puzzle" />
                  </span>
                  <div>
                    <h2>{detail.manifest.name}</h2>
                    <p>Publisher: {detail.manifest.publisher}</p>
                  </div>
                </div>
                <p className="settings-description">{detail.manifest.description}</p>
                <div className="setting-line">
                  <strong>Version</strong>
                  <span>
                    {installedFor(selected)
                      ? `Installed ${installedFor(selected).version}`
                      : detail.manifest.version}
                  </span>
                </div>
                <div className="setting-line">
                  <strong>Release status</strong>
                  <span>{detail.status}</span>
                </div>
                <div className="setting-line">
                  <strong>Platforms</strong>
                  <span>{detail.manifest.platforms.join(', ')}</span>
                </div>
                <h3>Requested permissions</h3>
                <ul className="store-permissions">
                  {detail.manifest.permissions.length ? (
                    detail.manifest.permissions.map((p) => (
                      <li key={p}>{permissionLabels[p] || p}</li>
                    ))
                  ) : (
                    <li>No additional permissions</li>
                  )}
                </ul>
                <p className="muted-text">
                  Restricted JavaScript runtime. No terminal, direct filesystem or network access.
                  Approval and a valid signature do not guarantee harmless code.
                </p>
                {installedFor(selected)?.error && (
                  <p className="notice" role="alert">
                    {installedFor(selected).error}
                  </p>
                )}
                {installedFor(selected) && (
                  <label className="setting-line">
                    <span>
                      <strong>Automatic updates</strong>
                      <small>Only approved releases without additional permissions.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={installedFor(selected).autoUpdate}
                      disabled={busy}
                      onChange={(e) => run(() => api.storeAutoUpdate(selected, e.target.checked))}
                    />
                  </label>
                )}
                {controls(detail)}
                {detail.sha256 && (
                  <details className="plugin-capabilities">
                    <summary>Package integrity</summary>
                    <code className="store-hash">SHA-256: {detail.sha256}</code>
                    <p className="muted-text">
                      Verified against signed registry metadata before installation.
                    </p>
                  </details>
                )}
              </section>
            </div>
          ) : (
            <>
              <div className="plugins-toolbar">
                <div className="search-input">
                  <Icon name="Search" size={16} />
                  <input
                    aria-label="Search store plugins"
                    placeholder="Search plugins or publishers …"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <label className="plugins-filter">
                  Show
                  <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                    <option value="all">All plugins</option>
                    <option value="installed">Installed</option>
                  </select>
                </label>
              </div>
              <div className="plugins-grid">
                {items.map((release) => {
                  const installed = installedFor(release.manifest.id);
                  return (
                    <article className="plugin-card" key={release.manifest.id}>
                      <div className="plugin-card-heading">
                        <span className="action-icon">
                          <Icon name="Puzzle" size={22} />
                        </span>
                        <span className="badge">
                          {release.status === 'approved' ? 'Reviewed release' : release.status}
                        </span>
                      </div>
                      <h3>{release.manifest.name}</h3>
                      <p>{release.manifest.description}</p>
                      <small className="plugin-platforms">By {release.manifest.publisher}</small>
                      <div className="plugin-card-footer">
                        <span>
                          {installed
                            ? `${installed.version} · ${installed.enabled ? 'Enabled' : 'Disabled'}`
                            : release.manifest.version}
                          {installed?.update ? ' · Update available' : ''}
                        </span>
                        <button
                          className="button small"
                          onClick={() => setSelected(release.manifest.id)}
                          aria-label={`Details for ${release.manifest.name}`}
                        >
                          Details
                          <Icon name="ChevronRight" size={15} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!items.length && (
                <div className="large-empty">
                  <Icon name="Puzzle" size={36} />
                  <h3>
                    {catalogStatus.kind === 'ready' ? 'No matching plugins' : catalogStatus.title}
                  </h3>
                  <p>{catalogStatus.message}</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
