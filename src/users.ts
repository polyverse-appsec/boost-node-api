import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, UpdateCommand, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-west-2" });
const dynamoDB = DynamoDBDocumentClient.from(client);

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

        const { Item } = await dynamoDB.send(new GetCommand(params));

        if (Item) {
            return {
                installationId: Item.installationId,
                username: Item.username,
                owner: Item.owner,
                details: Item.details,
                lastUpdated: Item.lastUpdated,
                authToken: Item.authToken
            } as UserInfo;
        }
    } catch (error) {
        console.error(`Error retrieving installation user info:`, error);
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
    const params = {
        TableName: installationsKeyValueStore,
        Item: {
            account: accountName,
            installationId,
            username,
            owner,
            details : installMessage,
            lastUpdated: Math.round(Date.now() / 1000),
            authToken
        },
    };
    await dynamoDB.send(new PutCommand(params));
}

export async function deleteUser(username: string, isOrg: boolean): Promise<void> {
    const queryParams = {
        TableName: installationsKeyValueStore,
        IndexName: 'username-index',
        KeyConditionExpression: 'username = :username',
        ExpressionAttributeValues: {
            ':username': username
        },
        ProjectionExpression: 'account'
    };

    try {
        let accountName = username;
        if (!isOrg) {
            const { Items } = await dynamoDB.send(new QueryCommand(queryParams));
            if (!Items || Items.length === 0) {
                console.log(`No installation info found for username: ${username}`);
                return;
            }
            accountName = Items[0].account;
        }

        const deleteParams = {
            TableName: installationsKeyValueStore,
            Key: {
                account: accountName
            }
        };

        await dynamoDB.send(new DeleteCommand(deleteParams));
        console.log(`Successfully deleted installation info for account: ${accountName}`);
    } catch (error) {
        console.error(`Error in processing deletion:`, error);
    }
}

export async function updateUser(accountName: string, authToken: string): Promise<void> {
    try {
        const updateParams: UpdateCommandInput = {
            TableName: installationsKeyValueStore,
            Key: {
                account: accountName
            },
            UpdateExpression: "set authToken = :authToken, lastUpdated = :lastUpdated",
            ExpressionAttributeValues: {
                ":authToken": authToken,
                ":lastUpdated": Math.round(Date.now() / 1000)
            },

            ReturnValues: "UPDATED_NEW"
        };

        const result = await dynamoDB.send(new UpdateCommand(updateParams));
        console.log(`Successfully updated user info for account: ${accountName}`, result);
    } catch (error) {
        console.error(`Error updating user info for account: ${accountName}`, error);
    }
}