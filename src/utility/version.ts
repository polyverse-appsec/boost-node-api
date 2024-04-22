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
    const majorCurrentVersion: number = parseInt(currentVersionParts[0]);
    const minorCurrentVersion: number = parseInt(currentVersionParts[1]);
    const majorVersion: number = parseInt(versionParts[0]);
    const minorVersion: number = parseInt(versionParts[1]);

    // check that the input version is the same or newer major and minor version
    if (majorCurrentVersion > majorVersion) {
        return false;
    } else if (majorCurrentVersion === majorVersion && minorCurrentVersion > minorVersion) {
        return false;
    } else {
        return true;
    }
}