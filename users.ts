import AWS from 'aws-sdk';

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const installationsKeyValueStore = 'Boost.GitHub-App.installations';

export async function getUser(email: string): Promise<{ installationId: string; username: string } | undefined> {
    try {
        const params = {
            TableName: installationsKeyValueStore,
            Key: { email } // primary key
        };

        const userInfo = await dynamoDB.get(params).promise();

        if (!userInfo.Item) return undefined;

        const installationId: string = userInfo.Item.installationId;
        const username: string = userInfo.Item.username;

        return { installationId, username };
    } catch (error) {
        console.error(`Error retrieving installation user info:`, error);
        return undefined;
    }
}

export async function saveUser(email: string, installationId: string, username: string): Promise<void> {
    const params = {
        TableName: installationsKeyValueStore,
        Item: {
            email, // primary key
            installationId,
            username,
        },
    };

    try {
        await dynamoDB.put(params).promise();
    } catch (error) {
        console.error(`Error saving user:`, error);
    }
}
