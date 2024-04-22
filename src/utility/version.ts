export const getCurrentVersion = () => {
    // get the current version from the package.json file
    const packageJson = require('../../package.json');
    return packageJson.version;
}

export const isCurrentMinorVersion = (version: string) => {
    const currentVersion = getCurrentVersion();
    const currentVersionParts = currentVersion.split('.');

    const versionParts = version.split('.');

    // compare the major and minor version numbers, ignoring the patch version
    return currentVersionParts[0] === versionParts[0] && currentVersionParts[1] === versionParts[1];
}