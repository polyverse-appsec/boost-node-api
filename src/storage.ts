import { DynamoDBClient, ScanCommand, ScanCommandInput } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DeleteCommandInput, GetCommand, GetCommandInput, PutCommand, PutCommandInput } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Use the region from the serverless environment configuration
const region = process.env.AWS_REGION || 'us-west-2'; // Fallback to 'us-west-2' if not set
const client = new DynamoDBClient({ region });
const dynamoDB = DynamoDBDocumentClient.from(client);

export const searchWildcard = '*';

interface BoostDynamoItem {
    projectPath: { S: string };
    dataPath: { S: string };
    data?: any;
    [key: string]: any; // For additional dynamic properties not explicitly defined
}

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
export async function searchProjectData<T>(email: string | undefined, sourceType: string, owner: string, project: string, resourcePath: string, analysisType: string): Promise<any[]> {
    let filterExpression = '';
    const expressionAttributeValues: Record<string, any> = {};

    // Handle wildcard and specific cases for email
    if (email !== "*" && email !== null) {
        // check for starting with this email
        filterExpression += 'begins_with(projectPath, :emailVal)';
        expressionAttributeValues[':emailVal'] = { S: email + '/' };
    }

    // Add sourceType to the filter
    filterExpression += (filterExpression ? ' AND ' : '') + 'contains(projectPath, :sourceTypeVal)';
    expressionAttributeValues[':sourceTypeVal'] = { S: "/" + sourceType + "/" };

    // Handle wildcard for owner
    if (owner !== "*") {
        filterExpression += ' AND contains(projectPath, :ownerVal)';
        expressionAttributeValues[':ownerVal'] = { S: "/" + owner + "/" };
    }

    // Handle wildcard for project
    if (project !== "*") {
        filterExpression += ' AND contains(projectPath, :projectVal)';
        expressionAttributeValues[':projectVal'] = { S: project };
    }

    // Construct dataPath
    const dataPathTarget = ((resourcePath == searchWildcard)?'':resourcePath) + '/' + analysisType;

    // Add dataPath to the filter (required and cannot be wildcarded)
    filterExpression += (resourcePath == searchWildcard)?' AND contains(dataPath, :dataPathTarget)':' AND dataPath = :dataPathTarget';
    expressionAttributeValues[':dataPathTarget'] = { S: dataPathTarget };

    let items: T[] = [];
    let exclusiveStartKey = undefined;
    let attempt = 0;
    const maxAttempts = 3;

    do {
        const params = {
            TableName: analysisDatastoreTableName,
            FilterExpression: filterExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ExclusiveStartKey: exclusiveStartKey
        } as ScanCommandInput;

        exclusiveStartKey = undefined; // Reset exclusiveStartKey for each attempt
        try {
            const response = await dynamoDB.send(new ScanCommand(params));
            if (response.Items?.length) {
                items = items.concat(response.Items
                    // if we are filtering on the resourcePath, then we need to filter the results
                    .filter(item =>
                        resourcePath !== searchWildcard || item.dataPath.S?.endsWith(dataPathTarget))
                    .map(item => {
                        const thisItem = item as BoostDynamoItem;
                        const projectPathParts = thisItem.projectPath.S.split('/');

                        const convertedItem = JSON.parse(thisItem.data.S) as T;
                        return {
                            ...convertedItem,
                            _userName: projectPathParts[0],
                            _ownerName: projectPathParts[2],
                            _repoName: projectPathParts[3],
                        } as T; // Cast to T, if T is the type you're working with
                    }));
            }

            exclusiveStartKey = response.LastEvaluatedKey;
            if (!exclusiveStartKey) {
                break; // Exit loop if no more items to retrieve
            }

            attempt = 0; // Reset attempt after successful response
        } catch (error: any) {
            console.error(`Attempt ${attempt + 1}: Error scanning project data:`, error);
            if (error.name === 'ProvisionedThroughputExceededException' && attempt < maxAttempts - 1) {
                const waitTime = (1000 * attempt) + (Math.random() * 1000); // Exponential backoff with jitter
                await new Promise(resolve => setTimeout(resolve, waitTime));
                attempt++;
                continue;
            } else {
                throw error; // Rethrow error if not related to throughput or max attempts reached
            }
        }
    } while (exclusiveStartKey);

    if (attempt >= maxAttempts && exclusiveStartKey) {
        console.warn('Not all items might have been retrieved due to reaching the maximum number of attempts.');
    }

    return items;
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function storeProjectData(email: string | null, sourceType: SourceType, owner: string, project: string, resourcePath: string, analysisType: string, data: any): Promise<void> {
    const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;

    const dataSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (process.env.TRACE_LEVEL) {
        console.log(`storeProjectData for (${dataSize} bytes): ${projectPath}${dataPath}`);
    }
    
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

export async function splitAndStoreData(
    email: string,
    sourceType: SourceType,
    ownerName: string,
    repoName: string,
    resourcePath: string,
    analysisType: string,
    body: any
    ): Promise<void> {

    const MAX_SIZE = 300 * 1024; // 300 KB
    const dataString = JSON.stringify(body);
    const dataSize = Buffer.byteLength(dataString, 'utf-8');

    if (dataSize <= MAX_SIZE) {
        // If data is smaller than MAX_SIZE, store it directly
        await storeProjectData(email, sourceType, ownerName, repoName, resourcePath, analysisType, body);
    } else {
        // If data is larger, split and store in parts
        let partNumber = 0;
        for (let offset = 0; offset < dataString.length; offset += MAX_SIZE) {
            partNumber++;
            const endOffset = offset + MAX_SIZE < dataString.length ? offset + MAX_SIZE : dataString.length;
            const partData = dataString.substring(offset, endOffset);

            // Call the store function for the part
            await storeProjectData(email, sourceType, ownerName, repoName, resourcePath, `${analysisType}:part-${partNumber}`, partData);
        }
        // add the null terminator (part) to ensure future writes don't reuse the multi-part base
        await storeProjectData(email, sourceType, ownerName, repoName, resourcePath, `${analysisType}:part-${partNumber + 1}`, '');
    }
}

export async function getCachedProjectData(email: string, sourceType: SourceType, ownerName: string, repoName: string, resourcePath: string, projectDataType: string): Promise<string | undefined> {
    let partNumber = 1;

    if (await doesPartExist(email, ownerName, repoName, resourcePath, projectDataType, 1)) {
        let allData = '';
        while (true) {
            const partData = await getProjectData(email, sourceType, ownerName, repoName, resourcePath, `${projectDataType}:part-${partNumber}`);
            // if we have no more parts, break
            if (!partData) break;

            // if we have an empty (e.g. "null-termination" part), break
            if (partData === '') break;

            allData += partData;
            partNumber++;
        }
        if (process.env.TRACE_LEVEL) {
            console.debug(`${email}:${ownerName}:${repoName}:${resourcePath}:${projectDataType}:getCachedProjectData: has ${partNumber} parts - ${allData.length} bytes`);
        }
        return allData;
    }

    const projectData = await getProjectData(email, sourceType, ownerName, repoName, resourcePath, projectDataType);

    return projectData;
}

// Helper function to check if a specific part exists
async function doesPartExist(email: string, ownerName: string, repoName: string, resourcePath: string, projectDataType: string, partNumber: number): Promise<boolean> {
    const partData = await getProjectData(email, SourceType.GitHub, ownerName, repoName, resourcePath, `${projectDataType}:part-${partNumber}`);
    return partData !== undefined;
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
