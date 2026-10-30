import packageInfo from '../package.json';

// Preserve the legacy major/minor/suffix API while displaying the release package version.
const [major, minor, patch] = packageInfo.version.split('.');
export const version = {major: Number(major), minor: Number(minor), suffix: '.' + patch};
