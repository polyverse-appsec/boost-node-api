import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

interface SecretObject {
  [key: string]: string;
}

const client = new SecretsManagerClient({ region: "us-west-2" });

export async function getSecrets(secretName: string): Promise<SecretObject> {
  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const rawSecretData = await client.send(command);
    if (rawSecretData.SecretString) {
      return JSON.parse(rawSecretData.SecretString);
    }
    throw new Error('Secret string is undefined');
  } catch (err) {
    console.error(`Error retrieving secrets from ${secretName}:`, err);
    throw err;
  }
}

export async function getSecret(secretName: string): Promise<string> {
  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const rawSecretData = await client.send(command);
    if (rawSecretData.SecretString) {
      return rawSecretData.SecretString;
    }
    throw new Error('Secret string is undefined');
  } catch (err) {
    console.error(`Error retrieving secrets from ${secretName}:`, err);
    throw err;
  }
}
