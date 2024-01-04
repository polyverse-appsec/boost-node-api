import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DeleteCommandInput, DynamoDBDocumentClient, GetCommand, GetCommandInput, PutCommand, PutCommandInput } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-west-2" });
const dynamoDB = DynamoDBDocumentClient.from(client);

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

    console.log(`getProjectData for: ${projectPath}${dataPath}`);

    const params : GetCommandInput = {
        TableName: analysisDatastoreTableName,
        Key: {
            projectPath: projectPath, // primary key
            dataPath: dataPath // secondary/sort key
        }
    };

    let attempt = 0;
    while (attempt < 5) {
        try {
            const data = await dynamoDB.send(new GetCommand(params));
            return data.Item ? data.Item.data : undefined;
        } catch (error: any) {
            if (error.name === 'ProvisionedThroughputExceededException') {
                console.error(`Attempt ${attempt + 1}: Throughput exceeded, retrying...`);
                await sleep(2000 + attempt * 1000); // Exponential backoff
            } else {
                console.error(`Error getting project data: ${error}`);
                throw error;
            }
        }
        attempt++;
    }
    throw new Error('Maximum retry attempts reached');    
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function storeProjectData(email: string | null, sourceType: SourceType, owner: string, project: string, resourcePath: string, analysisType: string, data: any): Promise<void> {
    const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;

    const dataSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
    console.log(`storeProjectData for (${dataSize} bytes): ${projectPath}${dataPath}`);

    const params : PutCommandInput = {
        TableName: analysisDatastoreTableName,
        Item: {
            projectPath: projectPath, // primary key
            dataPath: dataPath, // secondary/sort key
            data: data
        }
    };

    // we're going to throttle waits for DynamoDB throughput exceeded errors
    //    and then we can tune table capacity
    let retries = 0;
    const maximumRetries = 8;

    while (retries < maximumRetries) {
        try {
            await dynamoDB.send(new PutCommand(params));
            return;
        } catch (error: any) {
            if (error.name === 'ProvisionedThroughputExceededException') {
                const waitTime = (2 ** retries) + (Math.random() * (10000 - 3000) + 3000) / 1000;
                console.log(`Waiting for ${waitTime.toFixed(3)} seconds... due to DynamoDB throughput exceeded`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                retries++;
            } else {
                console.error(`Error writing to DynamoDB: ${error}`);
                throw error;
            }
        }
    }
}

export async function deleteProjectData(email: string | null, sourceType: SourceType, owner: string, project: string, resourcePath: string, analysisType: string): Promise<void> {
    const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;

    const params : DeleteCommandInput = {
        TableName: analysisDatastoreTableName,
        Key: {
            projectPath: projectPath, // primary key
            dataPath: dataPath, // secondary/sort key
        }
    };

    try {
        await dynamoDB.send(new DeleteCommand(params));
    } catch (error) {
        console.error(`Error deleting project data: ${error}`);
        throw error;
    }
}