import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

interface SecretObject {
    [key: string]: string;
}

// Use the region from the serverless environment configuration
const region = process.env.AWS_REGION || "us-west-2"; // Default to 'us-west-2' if not set
const client = new SecretsManagerClient({ region });

// In-memory cache for secret strings
const secretsCache = new Map<string, string>();

// Counter for successful cache retrievals
let successfulCacheRetrievals = 0;

const isCacheEnabled = !process.env.DISABLE_SECRET_CACHE;

export async function getSecretsAsObject(
    secretName: string
): Promise<SecretObject> {
    if (isCacheEnabled && secretsCache.has(secretName)) {
        const cachedSecretString = secretsCache.get(secretName) as string;
        successfulCacheRetrievals++;
        return JSON.parse(cachedSecretString);
    }

    try {
        const command = new GetSecretValueCommand({ SecretId: secretName });
        const rawSecretData = await client.send(command);
        if (!rawSecretData.SecretString) {
            throw new Error("Secret string is undefined");
        }

        if (isCacheEnabled) {
            secretsCache.set(secretName, rawSecretData.SecretString);
        }
        return JSON.parse(rawSecretData.SecretString);
    } catch (err) {
        console.error(`Error retrieving secrets from ${secretName}:`, err);
        throw err;
    }
}

export async function getSingleSecret(secretName: string): Promise<string> {
    if (isCacheEnabled && secretsCache.has(secretName)) {
        successfulCacheRetrievals++;
        return secretsCache.get(secretName) as string;
    }

    try {
        const command = new GetSecretValueCommand({ SecretId: secretName });
        const rawSecretData = await client.send(command);
        if (!rawSecretData.SecretString) {
            throw new Error("Secret string is undefined");
        }

        if (isCacheEnabled) {
            secretsCache.set(secretName, rawSecretData.SecretString);
        }
        return rawSecretData.SecretString;
    } catch (err) {
        console.error(`Error retrieving secret from ${secretName}:`, err);
        throw err;
    }
}
