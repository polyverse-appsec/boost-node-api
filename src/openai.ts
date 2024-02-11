import { getSecretsAsObject as getSecretsAsObject } from './secrets';
import { ProjectDataReference } from './types/ProjectDataReference';

import fetch from 'node-fetch';
import FormData from 'form-data';

export async function uploadProjectDataForAIAssistant(email: string, projectName: string, uri: URL, dataTypeId: string, simpleFilename: string, projectData: string) : Promise<ProjectDataReference> {

    if (!projectData) {
        throw new Error('Invalid project data');
    }

    if (process.env.TRACE_LEVEL) {
        console.debug(`store_data_for_project: projectData received`);
    }

    // Split the pathname by '/' and filter out empty strings
    const pathSegments = uri.pathname.split('/').filter(segment => segment);

    // The relevant part is the last segment of the path
    const repoName = pathSegments.pop();
    const ownerName = pathSegments.pop();
    if (!repoName || !ownerName) {
        throw new Error(`Invalid URI: ${uri}`);
    }

    const projectQualifiedFullFilename = `${projectName}_${generateFilenameFromGitHubProject(email, ownerName, repoName)}_${simpleFilename}`;

    if (process.env.TRACE_LEVEL) {
        console.debug(`AI file resource name: ${projectQualifiedFullFilename}`);
    }
    const openAiFile : OpenAIFileUploadResponse = await createAssistantFileWithRetry(projectQualifiedFullFilename, projectData);

    const dataResource : ProjectDataReference = {
        name: `${projectQualifiedFullFilename}`,
        type: `${dataTypeId}`,
        id: openAiFile.id,
        // return current time in unix system time format
        lastUpdated: openAiFile.created_at,
    }

    return dataResource;
}

function generateFilenameFromGitHubProject(part0: string, part1: string, part2: string): string {
    // Replace any non-alphanumeric characters (including dots) with underscores
    const safePart0 = part0.replace(/[^a-zA-Z0-9]/g, '_');
    const safePart1 = part1.replace(/[^a-zA-Z0-9]/g, '_');
    const safePart2 = part2.replace(/[^a-zA-Z0-9]/g, '_');

    // Combine the parts with an underscore
    return `${safePart0}_${safePart1}_${safePart2}`;
}

export interface OpenAIFileUploadResponse {
    id: string;
    object: string;
    bytes: number;
    created_at: number;
    filename: string;
    purpose: string;
}

interface ErrorResponse {
    message: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const createAssistantFileWithRetry = async (dataFilename: string, data: string, maxRetries = 1, retryDelay = 2000) => {
    let attempts = 0;
    let lastError;

    while (attempts <= maxRetries) {
        try {
            return await createAssistantFile(dataFilename, data);
        } catch (error: any) {
            // if we exceeded rate limit, don't retry
            if (error.message.includes(`exceeded`)) {
                throw error;
            }
            lastError = error;
            if (attempts < maxRetries) {
                console.log(`Attempt ${attempts + 1} failed, retrying in ${retryDelay / 1000} seconds...`);
                await delay(retryDelay); // Wait for specified delay before retrying
            }
        }
        attempts++;
    }
    throw lastError;
};

const createAssistantFile = async (dataFilename: string, data: string): Promise<OpenAIFileUploadResponse> => {
    const secretData : any = await getSecretsAsObject('exetokendev');
    let openAiKey = secretData['openai-personal'];

    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const createFileRest = 'https://api.openai.com/v1/files';

    const dataSize = Buffer.byteLength(data, 'utf8');
    console.log(`createAssistantFile for (${dataSize} bytes): ${dataFilename}`);

    const formData = new FormData();
    formData.append('purpose', 'assistants');
    formData.append('file', Buffer.from(data), { filename: dataFilename} as FormData.AppendOptions);

    if (process.env.SIMULATE_OPENAI_UPLOAD) {
        // create a random filename that looks like file-UiXGn8C8EspnjK6mkezQMhhh
        const simulatedFileId = `file-${Math.random().toString(36).substring(7)}`;
        const simulatedFileData : OpenAIFileUploadResponse = {
            id: simulatedFileId,
            object: 'file',
            bytes: dataSize,
            created_at: Date.now(),
            filename: dataFilename,
            purpose: 'assistants',
        };
        console.error(`Simulated file upload: ${simulatedFileData.id} ${simulatedFileData.filename} at ${simulatedFileData.created_at} bytes: ${simulatedFileData.bytes}`);

        return simulatedFileData
    }

    const response = await fetch(createFileRest, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
            ...formData.getHeaders(),
        },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        try {
            const errorObj = errorText ? JSON.parse(errorText) : null;

            // Check if the error is due to rate limiting
            if (response.status === 429 && errorObj && errorObj.error && errorObj.error.code === "rate_limit_exceeded") {
                throw new Error(`Rate limit exceeded: ${errorObj.error.message}`);
            } else {
                // For other errors, include the original error message
                throw new Error(`OpenAI Upload failure for ${dataFilename} status: ${response.status}, error: ${errorText}`);
            }
        } catch (error: any) {
            // check if JSON.parse failed
            if (error instanceof SyntaxError) {
                // Handle JSON parsing error
                throw new Error(`Error parsing response from OpenAI for ${dataFilename}: ${error.message}`);
            } else {
                // Rethrow the original error if it's not a parsing error
                throw new Error(`OpenAI Upload failure for ${dataFilename} status: ${response.status}, error: ${errorText} - cascading error: ${error}`);
            }
        }
    }

    const responseData: OpenAIFileUploadResponse = await response.json() as OpenAIFileUploadResponse;
    return responseData; // Return only the id from the response
};

export const deleteAssistantFile = async (fileId: string): Promise<void> => {
    const secretData : any = await getSecretsAsObject('exetokendev');
    let openAiKey = secretData['openai-personal'];

    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const deleteFileIdRest = 'https://api.openai.com/v1/files/${fileId}';

    const response = await fetch(deleteFileIdRest, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
        },
    });

    if (response.ok) {
        return;
    }

    const errorText = await response.text();
    try {
        const errorObj = errorText ? JSON.parse(errorText) : null;

        // Check if the error is due to rate limiting
        if (response.status === 429 && errorObj && errorObj.error && errorObj.error.code === "rate_limit_exceeded") {
            throw new Error(`Rate limit exceeded: ${errorObj.error.message}`);
        } else {
            // For other errors, include the original error message
            throw new Error(`OpenAI Delete file failure for ${fileId} status: ${response.status}, error: ${errorText}`);
        }
    } catch (error: any) {
        // check if JSON.parse failed
        if (error instanceof SyntaxError) {
            // Handle JSON parsing error
            throw new Error(`Error parsing response from OpenAI Delete File for ${fileId}: ${error.message}`);
        } else {
            // Rethrow the original error if it's not a parsing error
            throw new Error(`OpenAI Delete File failure for ${fileId} status: ${response.status}, error: ${errorText} - cascading error: ${error}`);
        }
    }

};