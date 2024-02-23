import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCommand, GetCommandInput, GetCommandOutput, PutCommand, PutCommandInput, PutCommandOutput } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

interface SecretObject {
    [key: string]: string;
}

interface BoostDynamoCriticalDataItem {
    resourcePath: string;
    data?: string;
}

// Use the region from the serverless environment configuration
const region = process.env.AWS_REGION || "us-west-2"; // Default to 'us-west-2' if not set
const secretsClient = new SecretsManagerClient({ region });
const dynamoDBClient = new DynamoDBClient({ region });
const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

// In-memory cache for secret strings
const secretsCache = new Map<string, string>();

// Counter for successful cache retrievals
let successfulCacheRetrievals = 0;

const isCacheEnabled = !process.env.DISABLE_SECRET_CACHE;
const criticalDataTableName = process.env.DYNAMO_DB_CRITICALDATA || "Boost.CriticalData.prod"; // Fallback to 'prod' stage if env var not set

export async function getSecretsAsObject(
    secretName: string,
    secretEntry: string = "" // if not provided, then this is a property inside a JSON obejct at secretName - otherwise, this is the secret key in Dynamo
): Promise<string> {
    if (isCacheEnabled && secretsCache.has(`${secretEntry?secretEntry:secretName}`)) {
        const cachedSecretString = secretsCache.get(`${secretEntry?secretEntry:secretName}`) as string;
        successfulCacheRetrievals++;
        return cachedSecretString;
    }

    // Attempt to retrieve from DynamoDB first
    try {
        const itemLookup: BoostDynamoCriticalDataItem = {
            resourcePath: `${secretEntry?secretEntry:secretName}`,
        };
        const getCommand = new GetCommand({
            TableName: criticalDataTableName,
            Key: itemLookup,
        } as GetCommandInput);
        const result = await dynamoDB.send(getCommand) as GetCommandOutput;
        if (result.Item && result.Item.data) {
            const data = result.Item.data;
            if (isCacheEnabled) {
                secretsCache.set(`${secretEntry?secretEntry:secretName}`, data);
            }
            return data;
        }
    } catch (err) {
        console.error(`Error retrieving data from DynamoDB for ${secretName}:`, err);
    }

    // Fallback to SecretManager
    try {
        console.warn(`Falling back to SecretManager for ${secretEntry?secretEntry:secretName}`);
        const command = new GetSecretValueCommand({ SecretId: secretName });
        const rawSecretData = await secretsClient.send(command);
        if (!rawSecretData.SecretString) {
            throw new Error("Secret string is undefined");
        }

        const secretData = secretEntry !== "" ? JSON.parse(rawSecretData.SecretString)[secretEntry] : rawSecretData.SecretString;
        if (isCacheEnabled) {
            secretsCache.set(`${secretEntry?secretEntry:secretName}`, secretData);
        }
        await writeToDynamoDB(`${secretEntry?secretEntry:secretName}`, secretData);

        return secretData;
    } catch (err) {
        console.error(`Error retrieving secrets from SecretManager for ${secretName}:`, err);
        throw err;
    }
}

export async function getSingleSecret(secretName: string): Promise<string> {
    if (isCacheEnabled && secretsCache.has(secretName)) {
        successfulCacheRetrievals++;
        return secretsCache.get(secretName) as string;
    }

    // Attempt to retrieve from DynamoDB first
    try {
        const itemLookup: BoostDynamoCriticalDataItem = {
            resourcePath: secretName,
        };
        const getCommand = new GetCommand({
            TableName: criticalDataTableName,
            Key: itemLookup,
        } as GetCommandInput);
        const result = await dynamoDB.send(getCommand) as GetCommandOutput;
        if (result.Item && result.Item.data) {
            if (isCacheEnabled) {
                secretsCache.set(secretName, result.Item.data);
            }
            return result.Item.data;
        }
    } catch (err) {
        console.error(`Error retrieving data from DynamoDB for ${secretName}:`, err);
    }

    // Fallback to SecretManager
    try {
        console.warn(`Falling back to SecretManager for ${secretName}`);
        const command = new GetSecretValueCommand({ SecretId: secretName });
        const rawSecretData = await secretsClient.send(command);
        if (!rawSecretData.SecretString) {
            throw new Error("Secret string is undefined");
        }

        if (isCacheEnabled) {
            secretsCache.set(secretName, rawSecretData.SecretString);
        }

        await writeToDynamoDB(secretName, rawSecretData.SecretString);

        return rawSecretData.SecretString;
    } catch (err) {
        console.error(`Error retrieving secret from SecretManager for ${secretName}:`, err);
        throw err;
    }
}

async function writeToDynamoDB(secretName: string, data: string): Promise<void> {
    // by default we're not going to build the cache - so we can disable write permissions via the service, and require admin
    if (!process.env.BUILD_CRITICALDATA_CACHE) {
        return;
    }

    const putData : BoostDynamoCriticalDataItem = {
        resourcePath: secretName,
        data: data
    };
    const putCommand = new PutCommand({
        TableName: criticalDataTableName,
        Item: putData
    });
    await dynamoDB.send(putCommand);
}