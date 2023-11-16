const AWS = require('aws-sdk');

async function getSecrets(secretName, region = 'us-west-2') {
    const client = new AWS.SecretsManager({ region });
    try {
        const rawSecretData = await client.getSecretValue({ SecretId: secretName }).promise();
        const secretObject = JSON.parse(rawSecretData.SecretString);
        return secretObject;
    } catch (err) {
        console.error(`Error retrieving secrets from ${secretName}:`, err);
        throw err;
    }
}

async function getSecret(secretName, region = 'us-west-2') {
    const client = new AWS.SecretsManager({ region });
    try {
        const rawSecretData = await client.getSecretValue({ SecretId: secretName }).promise();
        return rawSecretData.SecretString;
    } catch (err) {
        console.error(`Error retrieving secrets from ${secretName}:`, err);
        throw err;
    }
}

module.exports = { getSecrets, getSecret };
