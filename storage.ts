import AWS from 'aws-sdk';

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const analysisDatastoreTableName = 'Boost.AnalysisDataStore';

export enum SourceType {
    GitHub = 'github',
    General = 'blob'
}

// Function to convert string to SourceType
export function convertToSourceType(source: string): SourceType {
    return Object.values(SourceType).find(type => type === source) || SourceType.General;
}

export async function getProjectData(email: string | null, sourceType: SourceType, owner: string, project: string, resourcePath: string, analysisType: string): Promise<any | undefined> {
    const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;
    console.log(`getProjectData for: ${projectPath}/${dataPath}`);

    const params: AWS.DynamoDB.DocumentClient.GetItemInput = {
        TableName: analysisDatastoreTableName,
        Key: {
            tableKey: projectPath, // primary key
            dataPath: dataPath // secondary/sort key
        }
    };

    const data = await dynamoDB.get(params).promise();

    if (!data.Item || !data.Item.data) {
        return undefined;
    }

    return data.Item.data;
}

export async function storeProjectData(email: string | null, sourceType: SourceType, owner: string, project: string, resourcePath: string, analysisType: string, data: any): Promise<void> {
    const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;

    const dataSize = Buffer.byteLength(data, 'utf8');

    console.log(`storeProjectData for (${dataSize} bytes): ${projectPath}/${dataPath}`);

    const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
        TableName: analysisDatastoreTableName,
        Item: {
            tableKey: projectPath, // primary key
            dataPath: dataPath, // secondary/sort key
            data: data
        }
    };

    await dynamoDB.put(params).promise();
}
