import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { DynamoDB } from '@aws-sdk/client-dynamodb';

// Use the region from the serverless environment configuration
const region = process.env.AWS_REGION || 'us-west-2'; // Fallback to 'us-west-2' if not set
const dynamoDBClient = new DynamoDB({ region });
const dynamoDB = DynamoDBDocument.from(dynamoDBClient);

const installationsKeyValueStore = process.env.DYNAMO_DB_ANALYSIS || 'Boost.GitHub-App.installations';

// Retrieves user information from DynamoDB
export async function getUser(account: string): Promise<{ installationId: string; username: string } | undefined> {
    try {
        const params = {
            TableName: installationsKeyValueStore,
            Key: { account } // primary key
        };

        const userInfo = await dynamoDB.get(params);

        if (!userInfo.Item) return undefined;

        const installationId: string = userInfo.Item.installationId;
        const username: string = userInfo.Item.username;

        return { installationId, username };
    } catch (error) {
        console.error(`Error retrieving installation user info:`, error);
        return undefined;
    }
}

// Saves user information to DynamoDB
export async function saveUser(account: string, installationId: string, username: string): Promise<void> {
    const params = {
        TableName: installationsKeyValueStore,
        Item: {
            account, // primary key
            installationId,
            username,
        },
    };

    try {
        await dynamoDB.put(params);
    } catch (error) {
        console.error(`Error saving user:`, error);
    }
}
