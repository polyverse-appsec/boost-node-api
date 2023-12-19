const dynamoDB = new AWS.DynamoDB.DocumentClient();

const installationsKeyValueStore = 'Boost.GitHub-App.installations';

export async function getUser (email) {
    // Get user information, including email address
    let installationId;
    try {
        // load from DynamoDB
        const params = {
            TableName: installationsKeyValueStore,
            Key: {
                email: email // primary key
            }
        };

        const userInfo = await dynamoDB.get(params).promise();

        installationId = userInfo.Item.installationId;
        const installingUser = userInfo.Item.username;

    } catch (error) {

        console.error(`Error retrieving installation user info:`, error);

        return undefined;
    }
}

export async function saveUser (email, installationId, username) {
    // Save to DynamoDB
    const params = {
        TableName: installationsKeyValueStore,
        Item: {
            email: email, // primary key
            installationId: installationId,
            username: username,
        },
    };
}