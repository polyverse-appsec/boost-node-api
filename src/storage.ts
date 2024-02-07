import { DynamoDBClient, ScanCommand, ScanCommandInput } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DeleteCommandInput, GetCommand, GetCommandInput, PutCommand, PutCommandInput } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// Use the region from the serverless environment configuration
const region = process.env.AWS_REGION || 'us-west-2'; // Fallback to 'us-west-2' if not set
const client = new DynamoDBClient({ region });
const dynamoDB = DynamoDBDocumentClient.from(client);

// Use the environment variable DYNAMO_DB_ANALYSIS for the table name
const analysisDatastoreTableName = process.env.DYNAMO_DB_ANALYSIS || "Boost.AnalysisDataStore.prod";

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

    if (process.env.TRACE_LEVEL) {
        console.log(`getProjectData for: ${projectPath}${dataPath}`);
    }

    const params : GetCommandInput = {
        TableName: analysisDatastoreTableName,
        Key: {
            projectPath,
            dataPath
        }
    };

    let attempt = 0;
    while (attempt < 5) {
        try {
            const data = await dynamoDB.send(new GetCommand(params));
            return data.Item ? data.Item.data : undefined;
        } catch (storageReadError: any) {
            console.error(`Attempt ${attempt + 1}: Error getting project data: ${storageReadError}`);
            if (storageReadError.name === 'ProvisionedThroughputExceededException') {
                const waitTime = (1000 * attempt) + (Math.random() * 2000); // Random backoff
                console.error(`Throughput exceeded, retrying in ${waitTime / 1000} seconds`);
                await sleep(waitTime);
            } else {
                throw storageReadError;
            }
        }
        attempt++;
    }
    throw new Error('Maximum retry attempts reached');    
}

// to search "public" data, pass "*" as email
// to search private data for all users, pass null as email
// to search for any project - use "*" fpr project name
// to search for any owner - use "*" for owner name
export async function searchProjectData(email: string | null, sourceType: SourceType, owner: string, project: string, resourcePath: string, analysisType: string): Promise<any[]> {
    let filterExpression = '';
    const expressionAttributeValues: Record<string, any> = {};

    // Handle wildcard and specific cases for email
    if (email !== "*" && email !== null) {
        filterExpression += 'contains(projectPath, :emailVal)';
        expressionAttributeValues[':emailVal'] = { S: email };
    }

    // Add sourceType to the filter
    filterExpression += (filterExpression ? ' AND ' : '') + 'contains(projectPath, :sourceTypeVal)';
    expressionAttributeValues[':sourceTypeVal'] = { S: sourceType };

    // Handle wildcard for owner
    if (owner !== "*") {
        filterExpression += ' AND contains(projectPath, :ownerVal)';
        expressionAttributeValues[':ownerVal'] = { S: owner };
    }

    // Handle wildcard for project
    if (project !== "*") {
        filterExpression += ' AND contains(projectPath, :projectVal)';
        expressionAttributeValues[':projectVal'] = { S: project };
    }

    // Add resourcePath (which is required, and cannot be wildcarded)
    filterExpression += ' AND contains(dataPath, :resourcePathVal)';
    expressionAttributeValues[':resourcePathVal'] = { S: resourcePath };

    // Add analysisType (which is required, and cannot be wildcarded)
    filterExpression += ' AND contains(dataPath, :analysisTypeVal)';
    expressionAttributeValues[':analysisTypeVal'] = { S: analysisType };

    // Scan parameters
    const params: ScanCommandInput = {
        TableName: analysisDatastoreTableName,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues
    };

    // Execute the scan with retries for provisioned throughput exceeded
    let attempt = 0;
    const maxAttempts = 5;
    while (attempt < maxAttempts) {
        try {
            const data = await dynamoDB.send(new ScanCommand(params));
            return data.Items ? data.Items.map(item => unmarshall(item)) : [];
        } catch (error: any) {
            console.error(`Attempt ${attempt + 1}: Error scanning project data: ${error}`);
            if (error.name === 'ProvisionedThroughputExceededException') {
                const waitTime = (1000 * attempt) + (Math.random() * 2000); // Exponential backoff with jitter
                console.error(`Throughput exceeded, retrying in ${waitTime / 1000} seconds`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                attempt++;
            } else {
                throw error;
            }
        }
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
            projectPath,
            dataPath,
            data
        }
    };

    let retries = 0;
    const maximumRetries = 8;
    while (retries < maximumRetries) {
        try {
            await dynamoDB.send(new PutCommand(params));
            return;
        } catch (storageWriteError: any) {
            console.error(`Error writing to DynamoDB: ${storageWriteError}`);
            if (storageWriteError.name === 'ProvisionedThroughputExceededException') {
                const waitTime = (2 ** retries) + Math.random() * 7000;
                console.error(`Throughput exceeded, retrying in ${waitTime / 1000} seconds`);
                await sleep(waitTime);
                retries++;
            } else {
                throw storageWriteError;
            }
        }
    }
    throw new Error('Maximum retries exceeded');
}

export async function deleteProjectData(email: string | null, sourceType: SourceType, owner: string, project: string, resourcePath: string, analysisType: string): Promise<void> {
    const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;

    const params : DeleteCommandInput = {
        TableName: analysisDatastoreTableName,
        Key: {
            projectPath,
            dataPath
        }
    };

    try {
        await dynamoDB.send(new DeleteCommand(params));
    } catch (error) {
        console.error(`Error deleting project data: ${error}`);
        throw error;
    }
}
