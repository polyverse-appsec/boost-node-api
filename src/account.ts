import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-west-2" });
const dynamoDB = DynamoDBDocument.from(client);

const githubAppUserKeyValueStore = 'Boost.GitHub-App.installations';
const reverseAccountLookupByUsernameSecondaryIndex = 'username-index';

// for pretty printing dates in error messages and logs
// print the date in PST with 12-hour time
const usFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',

    year: 'numeric',
    month: 'long',
    day: '2-digit',

    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    
    hour12: true
});

export interface UserInfo {
    account?: string;
    installationId?: string;
    username: string;
    admin?: string;
    details?: string;
    lastUpdated?: number;
    authToken?: string;
}

export async function getAccountByUsername(username: string): Promise<UserInfo | undefined> {
    try {
        const params = {
            TableName: githubAppUserKeyValueStore,
            IndexName: reverseAccountLookupByUsernameSecondaryIndex,
            KeyConditionExpression: 'username = :username',
            ExpressionAttributeValues: {
                ':username': username,
            },
        };

        const item = await dynamoDB.query(params);
        if (item.Items && item.Items.length > 0) {
            // look for user info where the account is an email address
            for (const user of item.Items) {
                if (user.account.includes('@')) {
                    return user as UserInfo;
                }
            }
        }
    } catch (error: any) {
        console.error(`Error retrieving user info by username:`, error.stack || error);
    }
    return undefined;
}

export async function getUser(accountName: string): Promise<UserInfo | undefined> {
    try {
        const params = {
            TableName: githubAppUserKeyValueStore,
            Key: {
                account: accountName
            }
        };

        const item = await dynamoDB.get(params);
        if (item.Item) {
            return item.Item as UserInfo;
        }
    } catch (error: any) {
        console.error(`Error retrieving user info:`, error.stack || error);
    }
    return undefined;
}

export async function saveUser(
    accountName: string,
    username: string,
    details: string,
    installationId?: string,
    admin?: string,
    authToken?: string): Promise<void> {
    try {
        // Build the update expression dynamically based on provided arguments
        let updateExpression = "set lastUpdated = :lastUpdated, username = :username, details = :details";
        let expressionAttributeValues: any = {
            ":lastUpdated": Math.round(Date.now() / 1000),
            ":username": username,
            ":details": details
        };

        if (installationId) {
            updateExpression += ", installationId = :installationId";
            expressionAttributeValues[":installationId"] = installationId;
        }
        if (admin) {
            updateExpression += ", admin = :admin";
            expressionAttributeValues[":admin"] = admin;
        }
        if (authToken) {
            updateExpression += ", authToken = :authToken";
            expressionAttributeValues[":authToken"] = authToken;
        }

        const updateParams = {
            TableName: githubAppUserKeyValueStore,
            Key: { account: accountName },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "UPDATED_NEW"
        } as UpdateCommandInput;

        await dynamoDB.update(updateParams);
        console.log(`Successfully updated user info for account: ${accountName}`);
    } catch (error: any) {
        console.error(`Error saving user info for account: ${accountName}`, error.stack || error);
    }
}

export async function deleteUserByUsername(username: string, requestor: string, deleteInstallationInfoOnly: boolean = false): Promise<void> {
    try {
        // Query to find all accounts associated with the username
        //      - This is necessary because the username is not the primary key
        //      And there may be placeholder accounts missing the known primary email key
        const queryResult = await dynamoDB.query({
            TableName: githubAppUserKeyValueStore,
            IndexName: reverseAccountLookupByUsernameSecondaryIndex,
            KeyConditionExpression: 'username = :username',
            ExpressionAttributeValues: {
                ':username': username,
            },
        });

        // If there are matching items, delete each one by its account name
        if (!queryResult.Items || queryResult.Items.length === 0) {
            console.log(`No user info found for username: ${username}`);
            return;
        }

        for (const item of queryResult.Items) {
            const accountName = item.account;
            if (deleteInstallationInfoOnly) {
                await updateUser(accountName, {
                    username: username,
                    installationId: undefined,
                    details: `Installation info deleted for username: ${username} by ${requestor} at ${usFormatter.format(new Date())}`,
                });
                console.log(`Successfully deleted installation info for account: ${accountName} for username: ${username}`);
            } else {
                try {
                    await dynamoDB.delete({
                        TableName: githubAppUserKeyValueStore,
                        Key: { account: accountName },
                    });
                    console.log(`Successfully deleted user info for account: ${accountName} for username: ${username}`);
                } catch (error: any) {
                    console.error(`Error in deleting user info for account: ${accountName} for username: ${username}`, error.stack || error);
                }
            }
        }
    } catch (error: any) {
        console.error(`Error in deleting user info for username: ${username}`, error.stack || error);
    }
}

export async function deleteUser(accountName: string): Promise<void> {
    try {
        await dynamoDB.delete({
            TableName: githubAppUserKeyValueStore,
            Key: { account: accountName },
        });
        console.log(`Successfully deleted user info for account: ${accountName}`);
    } catch (error: any) {
        console.error(`Error in deleting user info for accountName: ${accountName}`, error.stack || error);
    }
}

export async function updateUser(accountName: string, updatedInfo: UserInfo): Promise<void> {
    let updateParts: string[] = ["lastUpdated = :lastUpdated"];
    let removeParts: string[] = [];
    let expressionAttributeValues: any = {
        ":lastUpdated": Math.round(Date.now() / 1000),
    };

    // Handling authToken
    if (updatedInfo.hasOwnProperty('authToken')) {
        if (updatedInfo.authToken !== undefined) {
            updateParts.push("authToken = :authToken");
            expressionAttributeValues[":authToken"] = updatedInfo.authToken;
        } else {
            removeParts.push("authToken");
        }
    }

    // Handling installationId
    if (updatedInfo.hasOwnProperty('installationId')) {
        if (updatedInfo.installationId !== undefined) {
            updateParts.push("installationId = :installationId");
            expressionAttributeValues[":installationId"] = updatedInfo.installationId;
        } else {
            removeParts.push("installationId");
        }
    }

    // Handling details
    if (updatedInfo.hasOwnProperty('details') && updatedInfo.details !== undefined) {
        updateParts.push("details = :details");
        expressionAttributeValues[":details"] = updatedInfo.details;
    } else {
        updateParts.push("details = :details");
        expressionAttributeValues[":details"] = `Updated at ${usFormatter.format(new Date())}`;
    }

    // Construct UpdateExpression
    let updateExpression = "";
    if (updateParts.length > 0) {
        updateExpression += "SET " + updateParts.join(", ");
    }
    if (removeParts.length > 0) {
        updateExpression += (updateParts.length ? " " : "") + "REMOVE " + removeParts.join(", ");
    }

    if (updateParts.length === 1 && removeParts.length === 0) {
        console.warn(`No updates needed for user info for account: ${accountName}`);
        return;
    }

    try {
        const updateParams = {
            TableName: githubAppUserKeyValueStore,
            Key: { account: accountName },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: updateParts.length > 1 ? expressionAttributeValues : undefined,
        };

        await dynamoDB.update(updateParams);
        console.log(`Successfully updated user info for account: ${accountName}`);
    } catch (error) {
        console.error(`Error in updating user info for account: ${accountName}`, error);
    }
}

