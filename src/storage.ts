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

export async function getProjectData(
    email: string | null, sourceType: SourceType,
    owner: string, project: string,
    resourcePath: string,
    analysisType: string): Promise<any | undefined> {
    const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;

    if (process.env.TRACE_LEVEL) {
        console.log(`[Storage] getProjectData for: ${projectPath}${dataPath}`);
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
            console.error(`[Storage] Attempt ${attempt + 1}: Error getting project data: `, storageReadError.stack || storageReadError);
            if (storageReadError.name === 'ProvisionedThroughputExceededException') {
                const waitTime = (1000 * attempt) + (Math.random() * 2000); // Random backoff
                console.error(`[Storage] Throughput exceeded, retrying in ${waitTime / 1000} seconds`);
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
                const tempItems = response.Items    
                    // if we are filtering on the resourcePath, then we need to filter the results
                    .filter(item =>
                        resourcePath !== searchWildcard || item.dataPath.S?.endsWith(dataPathTarget))
                    .map(item => {
                        const thisItem = item as BoostDynamoItem;
                        try {
                            const projectPathParts = thisItem.projectPath.S.split('/');

                            if (!thisItem?.data?.S) {
                                console.error(`[Storage] SchemaError: No data field found for ${thisItem.projectPath.S}${thisItem.dataPath.S}`);
                                return null;
                            }

                            const convertedItem = JSON.parse(thisItem.data.S) as T;
                            return {
                                ...convertedItem,
                                _userName: projectPathParts[0],
                                _ownerName: projectPathParts[2],
                                _projectName: projectPathParts[3],
                            } as T; // Cast to T, if T is the type you're working with
                        } catch (error: any) {
                            console.error(`[Storage] SchemaError: Error retrieving ${thisItem?.projectPath?.S} ${thisItem?.dataPath?.S}:`, error.stack || error);
                            return null;
                        }
                    });
                // Now filter out the null values (or the flag values you used to indicate a failed conversion)
                items = items.concat(tempItems.filter(item => item !== null) as T[]);
            }

            exclusiveStartKey = response.LastEvaluatedKey;
            if (!exclusiveStartKey) {
                break; // Exit loop if no more items to retrieve
            }

            attempt = 0; // Reset attempt after successful response
        } catch (error: any) {
            console.error(`[Storage] Attempt ${attempt + 1}: Error scanning project data:`, error.stack || error);
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

export async function storeProjectData(
    email: string | undefined, sourceType: SourceType,
    owner: string, project: string,
    resourcePath: string,
    analysisType: string,
    data: any,
    serializeData: boolean = true) : Promise<void> {
    const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;

    const serializedProjectData = serializeData?JSON.stringify(data):data;

    if (Array.isArray(serializedProjectData)) {
        throw new Error('Array data not supported');
    }
    const dataSize = Buffer.byteLength(serializedProjectData, 'utf8');
    if (process.env.TRACE_LEVEL) {
        console.log(`[Storage] storeProjectData for (${dataSize} bytes): ${projectPath}${dataPath}`);
    }
    
    const params : PutCommandInput = {
        TableName: analysisDatastoreTableName,
        Item: {
            projectPath,
            dataPath,
            data: serializedProjectData
        }
    };

    let retries = 0;
    const maximumRetries = 8;
    while (retries < maximumRetries) {
        try {
            await dynamoDB.send(new PutCommand(params));
            return;
        } catch (storageWriteError: any) {
            console.error(`[Storage] Error writing to DynamoDB `, storageWriteError.stack || storageWriteError);
            if (storageWriteError.name === 'ProvisionedThroughputExceededException') {
                const waitTime = (2 ** retries) + Math.random() * 7000;
                console.error(`[Storage] Throughput exceeded, retrying in ${waitTime / 1000} seconds`);
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
        await storeProjectData(email, sourceType, ownerName, repoName, resourcePath, analysisType, dataString, false);

        // delete the first part if it exists - so ensure we don't have a stale multi-part piece that overrides the new data
        const canaryPartNumber = 1;
        await deleteProjectData(email, sourceType, ownerName, repoName, resourcePath, `${analysisType}:part-${canaryPartNumber}`);

    } else {
        try {
            // If data is larger, split and store in parts
            let partNumber = 0;
            for (let offset = 0; offset < dataString.length; offset += MAX_SIZE) {
                partNumber++;
                const endOffset = offset + MAX_SIZE < dataString.length ? offset + MAX_SIZE : dataString.length;
                const partData = dataString.substring(offset, endOffset);

                // Call the store function for the part
                await storeProjectData(email, sourceType, ownerName, repoName, resourcePath, `${analysisType}:part-${partNumber}`, partData, false);
            }
            // add the null terminator (part) to ensure future writes don't reuse the multi-part base
            await storeProjectData(email, sourceType, ownerName, repoName, resourcePath, `${analysisType}:part-${partNumber + 1}`, '', false);
        } finally {
            // ensure we delete the non-multi-part data (stale) if it exists - so ensure we don't have a stale single part that overrides the new data
            try {
                await deleteProjectData(email, sourceType, ownerName, repoName, resourcePath, analysisType);
            // we don't care if this fails, since the multi-part will be read by default anyway - but for debugging, its better to try and delete it, and log a warning if it fails
            } catch (error: any) {
                console.warn(`[Storage] ${email}:${ownerName}:${repoName}:${resourcePath}:${analysisType}:Unable to cleanup single-part data: `, error.stack || error);
            }
        }
    }
}

export async function getCachedProjectData<T>(
    email: string, sourceType: SourceType,
    ownerName: string, repoName: string,
    resourcePath: string, projectDataType: string,
    deserialize: boolean = true): Promise<T | undefined> {
    let partNumber = 1;

    let projectData = undefined;
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
        projectData = allData;
    }

    // if we didn't reassemble multi-part data, then look for single part data
    if (!projectData) {
        projectData = await getProjectData(email, sourceType, ownerName, repoName, resourcePath, projectDataType);
    }
    if (!deserialize) {
        return projectData as unknown as T;
    }
    const deserializedData = projectData ? JSON.parse(projectData) as T : undefined;

    return deserializedData;
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
    } catch (error: any) {
        console.error(`[Storage] Error deleting project data: `, error.stack || error);
        throw error;
    }
}
