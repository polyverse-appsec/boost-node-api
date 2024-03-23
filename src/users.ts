import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-west-2" });
const dynamoDB = DynamoDBDocument.from(client);

const installationsKeyValueStore = 'Boost.GitHub-App.installations';

interface UserInfo {
    installationId?: string;
    username: string;
    owner?: string;
    details?: string;
    lastUpdated?: number;
    authToken?: string;
}

export async function getUser(accountName: string): Promise<UserInfo | undefined> {
    try {
        const params = {
            TableName: installationsKeyValueStore,
            Key: {
                account: accountName
            }
        };

        const item = await dynamoDB.get(params);
        if (item.Item) {
            return item.Item as UserInfo;
        }
    } catch (error) {
        console.error(`Error retrieving user info:`, error);
    }
    return undefined;
}

export async function saveUser(
    accountName: string,
    installationId: string,
    username: string,
    owner: string,
    installMessage: string,
    authToken: string = ""): Promise<void> {
    try {
        const params = {
            TableName: installationsKeyValueStore,
            Item: {
                account: accountName,
                installationId,
                username,
                owner,
                details: installMessage,
                lastUpdated: Math.round(Date.now() / 1000),
                authToken
            },
        };
        await dynamoDB.put(params);
    } catch (error: any) {
        console.error(`Error saving user info for account: ${accountName}`, error.stack || error);
    }
}

export async function deleteUser(username: string): Promise<void> {
    try {
        // Query to find all accounts associated with the username
        const queryResult = await dynamoDB.query({
            TableName: installationsKeyValueStore,
            IndexName: 'username-index', // The name of the secondary index
            KeyConditionExpression: 'username = :username',
            ExpressionAttributeValues: {
                ':username': username,
            },
        });

        // If there are matching items, delete each one by its account name
        if (!queryResult.Items || queryResult.Items.length === 0) {
            console.log(`No installation info found for username: ${username}`);
            return;
        }

        for (const item of queryResult.Items) {
            const accountName = item.account; // Assuming 'account' is the correct attribute name
            await dynamoDB.delete({
                TableName: installationsKeyValueStore,
                Key: { account: accountName },
            });
            console.log(`Successfully deleted installation info for account: ${accountName}`);
        }
    } catch (error) {
        console.error(`Error in deleting installation info for username: ${username}`, error);
    }
}

export async function updateUser(accountName: string, authToken: string): Promise<void> {
    try {
        const updateParams = {
            TableName: installationsKeyValueStore,
            Key: { account: accountName },
            UpdateExpression: "set authToken = :authToken, lastUpdated = :lastUpdated",
            ExpressionAttributeValues: {
                ":authToken": authToken,
                ":lastUpdated": Math.round(Date.now() / 1000)
            }
        };

        await dynamoDB.update(updateParams);
        console.log(`Successfully updated installation info for account: ${accountName} - AuthToken updated`);
    } catch (error: any) {
        console.error(`Error in updating installation info for account: ${accountName}`, error.stack || error);
    }
}
