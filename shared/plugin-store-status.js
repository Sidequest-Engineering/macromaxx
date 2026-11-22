export function pluginStoreStatus(data = {}) {
  if (!data.configured)
    return {
      kind: 'disabled',
      title: 'The store is not connected yet',
      message:
        data.disabledReason ||
        'A registry URL and an independently pinned signing root must be configured by the app publisher. Installation stays disabled until that trust is configured.',
    };
  if (!data.trusted) {
    if (/HTTP (429|502|503|504)\b/.test(data.error || ''))
      return {
        kind: 'unavailable',
        title: 'Store temporarily unavailable',
        message:
          'The registry server is unavailable after bounded retries. Try Check for updates again later. Expired or unverified releases cannot be installed or run.',
      };
    return {
      kind: 'unverified',
      title: 'Registry not verified',
      message:
        'The catalog could not be authenticated or has expired. Refresh before installing, enabling or running store plugins.',
    };
  }
  if (!data.releases?.some((release) => release.status === 'approved'))
    return {
      kind: 'empty',
      title: 'No plugins published yet',
      message:
        'The signed registry was verified successfully. Approved plugins will appear here after maintainers publish them.',
    };
  return { kind: 'ready', title: 'Registry verified', message: 'Try another search or filter.' };
}
