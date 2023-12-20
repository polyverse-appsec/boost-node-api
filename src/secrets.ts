import * as AWS from 'aws-sdk';

interface SecretObject {
  [key: string]: string;
}

async function getSecrets(secretName: string, region: string = 'us-west-2'): Promise<SecretObject> {
  const client = new AWS.SecretsManager({ region });
  try {
    const rawSecretData = await client.getSecretValue({ SecretId: secretName }).promise();
    if (rawSecretData.SecretString) {
      return JSON.parse(rawSecretData.SecretString);
    }
    throw new Error('Secret string is undefined');
  } catch (err) {
    console.error(`Error retrieving secrets from ${secretName}:`, err);
    throw err;
  }
}

async function getSecret(secretName: string, region: string = 'us-west-2'): Promise<string> {
  const client = new AWS.SecretsManager({ region });
  try {
    const rawSecretData = await client.getSecretValue({ SecretId: secretName }).promise();
    if (rawSecretData.SecretString) {
      return rawSecretData.SecretString;
    }
    throw new Error('Secret string is undefined');
  } catch (err) {
    console.error(`Error retrieving secrets from ${secretName}:`, err);
    throw err;
  }
}

export { getSecrets, getSecret };
