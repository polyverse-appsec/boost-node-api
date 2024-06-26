import { getSecretsAsObject as getSecretsAsObject } from './secrets';
import { ProjectDataReference } from './types/ProjectDataReference';

import { usFormatter } from './utility/log';

import fetch from 'node-fetch';
import FormData from 'form-data';
import axios from 'axios';
import { HTTP_FAILURE_BUSY, HTTP_FAILURE_NOT_FOUND } from './utility/dispatch';

export async function uploadProjectDataForAIAssistant(email: string, org: string, project: string, repoUri: URL, dataTypeId: string, simpleFilename: string, projectData: string) : Promise<ProjectDataReference> {

    if (!projectData) {
        throw new Error('Invalid project data');
    }

    if (process.env.TRACE_LEVEL) {
        console.debug(`store_data_for_project: projectData received`);
    }

    // Split the pathname by '/' and filter out empty strings
    const pathSegments = repoUri.pathname.split('/').filter(segment => segment);

    // The relevant part is the last segment of the path
    const repoName = pathSegments.pop();
    const ownerName = pathSegments.pop();
    if (!repoName || !ownerName) {
        throw new Error(`Invalid URI: ${repoUri}`);
    }

    const projectQualifiedFullFilename = generateFilenameFromGitHubProject(email, org, project, ownerName, repoName, simpleFilename);

    if (process.env.TRACE_LEVEL) {
        console.debug(`AI file resource name being uploaded: ${projectQualifiedFullFilename}`);
    }
    const openAiFile : OpenAIFile = await createAssistantFileWithRetry(projectQualifiedFullFilename, projectData);

    const dataResource : ProjectDataReference = {
        name: `${projectQualifiedFullFilename}`,
        type: `${dataTypeId}`,
        id: openAiFile.id,
        // return current time in unix system time format
        lastUpdated: openAiFile.created_at,
    }

    return dataResource;
}

function generateFilenameFromGitHubProject(email: string, org: string, project: string, ownerName: string, repoName: string, simpleFilename: string): string {
    // Replace any non-alphanumeric characters (including dots) with underscores
    const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
    const safeOrg = org.replace(/[^a-zA-Z0-9]/g, '_');
    const safeProject = project.replace(/[^a-zA-Z0-9]/g, '_');
    const safeOwnerName = ownerName.replace(/[^a-zA-Z0-9]/g, '_');
    const safeRepoName = repoName.replace(/[^a-zA-Z0-9]/g, '_');

    const serviceVersion = process.env.APP_VERSION;
    if (!serviceVersion) {
        throw new Error('Service version not found');
    }
    const safeVersion = serviceVersion.replace(".", '_');

    // Combine the parts with an underscore
    return `sara_rest_v${safeVersion}_project_data_${safeEmail}_${safeOrg}__${safeProject}__${safeOwnerName}_${safeRepoName}__${simpleFilename}`;
}

export interface OpenAIFile {
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
            // if we exceeded rate limit, wait 3 seconds, retry once and give up if it fails again
            if (error.message.includes(`exceeded`)) {
                if (attempts > 1) {
                    // we're going to wait 2 seconds to self-throttle so a future AI call has a better chance
                    await delay(2000);
                    throw error;
                }
                console.log(`[OpenAI:createAssistantFileWithRetry] ${dataFilename} Rate limit exceeded, retrying in 3 seconds...`);
                await delay(3000); // we are allowed 1 call / second over a minute ; so this wait should be enough
            }
            lastError = error;
            if (attempts < maxRetries) {
                console.log(`[OpenAI:createAssistantFileWithRetry] ${dataFilename} Attempt ${attempts + 1} failed, retrying in ${retryDelay / 1000} seconds...`);
                await delay(retryDelay); // Wait for specified delay before retrying
            }
        }
        attempts++;
    }
    throw lastError;
};

const createAssistantFile = async (dataFilename: string, data: string): Promise<OpenAIFile> => {
    const openAiKey : any = await getSecretsAsObject('exetokendev', 'openai-personal');
    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const createFileRest = 'https://api.openai.com/v1/files';

    const dataSize = Buffer.byteLength(data, 'utf8');

    const formData = new FormData();
    formData.append('purpose', 'assistants');
    formData.append('file', Buffer.from(data), { filename: dataFilename} as FormData.AppendOptions);

    if (process.env.SIMULATE_OPENAI_UPLOAD) {
        // create a random filename that looks like file-UiXGn8C8EspnjK6mkezQMhhh
        const simulatedFileId = `file-simulate-${Math.random().toString(36).substring(2, 10)}`;
        const simulatedFileData : OpenAIFile = {
            id: simulatedFileId,
            object: 'file',
            bytes: dataSize,
            created_at: Date.now() / 1000,
            filename: dataFilename,
            purpose: 'assistants',
        };
        console.warn(`[OpenAI:createAssistantFile] ${dataFilename} SIMULATED: OpenAI file upload: ${simulatedFileData.id} ${simulatedFileData.filename} at ${simulatedFileData.created_at} bytes: ${simulatedFileData.bytes}`);

        return simulatedFileData
    }

    // get the current date time as a us formatted string
    const currentTime = usFormatter.format(new Date());

    const response = await fetch(createFileRest, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
            ...formData.getHeaders(),
        },
        body: formData
    });

    if (response.ok) {
        console.log(`[OpenAI:createAssistantFile] ${dataFilename} UPLOAD:SUCCEEDED: ${dataFilename} (${dataSize} bytes)`);

        const responseData: OpenAIFile = await response.json() as OpenAIFile;
        responseData.created_at = Date.now() / 1000; // store our own timestamp so we're sure time comparisons are consistent
        return responseData;
    }

    const errorText = await response.text();
    console.log(`[OpenAI:createAssistantFile] ${dataFilename} UPLOAD:FAILED(${response.status}): ${dataFilename} (${dataSize} bytes) due to error ${errorText}; Headers:${JSON.stringify(response.headers)}`);

    let errorObj = undefined;
    try {
        errorObj = errorText ? JSON.parse(errorText) : null;

        // Check if the error is due to rate limiting
        if (response.status === HTTP_FAILURE_BUSY && errorObj && errorObj.error && errorObj.error.code === "rate_limit_exceeded") {
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
            throw new Error(`OpenAI Upload failure for ${dataFilename} status: ${response.status}, error: ${errorObj?JSON.stringify(errorObj):errorText} - cascading error: ${error}`);
        }
    }
};

export const getOpenAIFile = async (fileId: string): Promise<OpenAIFile | undefined> => {
    const openAiKey : any = await getSecretsAsObject('exetokendev', 'openai-personal');
    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const getFileRest = `https://api.openai.com/v1/files/${fileId}`;

    const axiosConfig = {
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
        },
        timeout: 2000, // 2 second timeout
    };

    // Retry logic
    const maxRetries = 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            const response = await axios.get(getFileRest, axiosConfig);
            return response.data as OpenAIFile;
        } catch (error: any) {
            if (error?.response.status === 404) {
                return undefined;
            } else if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
                attempt++;
                if (attempt > maxRetries) {
                    throw new Error(`Failed to fetch ${fileId} after ${maxRetries + 1} attempts due to timeout.`);
                }
                const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';

                console.warn(`[OpenAI:getOpenAIFile] RETRY ${attempt} for ${fileId} after Error: ${error.message} - ${errorDetails}`);
            } else {
                console.error(`[OpenAI:getOpenAIFile] FAILED: ${fileId} after Error: ${error.message}`);
                // Handle non-timeout errors
                if (error.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    const errorMessage = error.response.data.error?.message || 'No error message';
                    const statusCode = error.response.status;
                    if (statusCode === HTTP_FAILURE_BUSY) {
                        throw new Error(`OpenAI Get Call Rate limit exceeded for ${fileId}: ${errorMessage}`);
                    } else {
                        throw new Error(`OpenAI Get file failure for ${fileId} status: ${statusCode}, error: ${errorMessage}`);
                    }
                } else if (error.request) {
                    // The request was made but no response was received
                    throw new Error(`OpenAI Get file failure for ${fileId}: No response from server`);
                } else {
                    // Something happened in setting up the request that triggered an Error
                    throw new Error(`Error fetching file ${fileId}: ${error.message}`);
                }
            }
        }
    }
    return undefined;
}

export const deleteAssistantFile = async (fileId: string): Promise<void> => {
    const openAiKey : any = await getSecretsAsObject('exetokendev', 'openai-personal');
    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const deleteFileIdRest = `https://api.openai.com/v1/files/${fileId}`;

    const axiosConfig = {
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
        },
        timeout: 2000, // 2 second timeout
    };

    // Retry logic
    const maxRetries = 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            await axios.delete(deleteFileIdRest, axiosConfig);

            // If call was successful, break out of the loop
            return;
        } catch (error: any) {
            if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
                attempt++;
                if (attempt > maxRetries) {
                    throw new Error(`Failed to delete ${fileId} after ${maxRetries + 1} attempts due to timeout.`);
                }

                const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';

                console.warn(`[OpenAI:deleteAssistantFile] RETRY ${attempt} for ${fileId} after Error: ${error.message} - ${errorDetails}`);
            } else {
                if (axios.isAxiosError(error) && error.response?.status === HTTP_FAILURE_NOT_FOUND) {
                    console.warn(`[OpenAI:deleteAssistantFile] FAILED: ${fileId} not found`);
                } else {
                    console.error(`[OpenAI:deleteAssistantFile] FAILED: ${fileId} after Error: ${error.message}`);
                }

                // Handle non-timeout errors
                if (error.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    const errorMessage = error.response.data.error?.message || 'No error message';
                    const statusCode = error.response.status;
                    if (statusCode === HTTP_FAILURE_BUSY.toString()) {
                        throw new Error(`OpenAI Delete Call Rate limit exceeded for ${fileId}: ${errorMessage}`);
                    } else {
                        throw new Error(`OpenAI Delete file failure for ${fileId} status: ${statusCode}, error: ${errorMessage}`);
                    }
                } else if (error.request) {
                    // The request was made but no response was received
                    throw new Error(`OpenAI Delete file failure for ${fileId}: No response from server`);
                } else {
                    // Something happened in setting up the request that triggered an Error
                    throw new Error(`Error deleting file ${fileId}: ${error.message}`);
                }
            }
        }
    }
};


export interface DataSearchCriteria {
    email?: string;
    org?: string;
    project?: string;
    repoUri?: URL;
    dataType?: string;
    limit?: number;
    creationStart?: number;
    startAtFileId?: string;
    filePrefixFilter?: string;
}

export const searchOpenAIFiles = async (criteria: DataSearchCriteria): Promise<OpenAIFile[]> => {
    const openAiKey : any = await getSecretsAsObject('exetokendev', 'openai-personal');
    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const { email, org, project, repoUri, dataType, limit, creationStart, startAtFileId, filePrefixFilter } = criteria;

    let files: OpenAIFile[] = [];
    let lastFileId: string | undefined = startAtFileId;
    const limitPerPage = 1000; // Max limit per page
    const actualLimit = limit || Infinity; // Use specified limit or no limit
    let totalFetched = 0;

    const ascending = true;

    const filterFiles = (retrievedFiles: OpenAIFile[]) : OpenAIFile[] => {
        // Split the pathname by '/' and filter out empty strings
        const pathSegments = !repoUri?undefined:repoUri.pathname!.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments?pathSegments.pop():undefined;
        const ownerName = pathSegments?pathSegments.pop():undefined;

        const filteredFiles = retrievedFiles.filter((file) => {
            let isMatch = true;
            if (email) {
                isMatch &&= file.filename.includes(`${email.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (org) {
                isMatch &&= file.filename.includes(`_${org.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (project) {
                isMatch &&= file.filename.includes(`_${project.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (repoName) {
                isMatch &&= file.filename.includes(`${repoName.toString().replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (ownerName) {
                isMatch &&= file.filename.includes(`${ownerName.toString().replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (dataType) {
                isMatch &&= file.filename.includes(`${dataType}`);
            }
            return isMatch;
        });
        return filteredFiles;
    }

    let page = 0;

    do {
        // we're going to use an internal undocumented OpenAI API to search files - as the public API only supports 10,000 files, no pagination, no sorting
        const getFilesRestEndpoint = `https://api.openai.com/v1/internal/files?${lastFileId ? `after=${lastFileId}&` : ''}limit=${limitPerPage}&order=${ascending?"asc":"desc"}&order_by=created_at`;

        let response = undefined;
        for (const iteration of [1, 2, 3]) {
            try {
                response = await fetch(getFilesRestEndpoint, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${openAiKey}`,
                    },
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to fetch files: ${getFilesRestEndpoint} ${errorText}`);
                }
            } catch (error: any) {
                if (iteration < 3) {
                    console.warn(`[OpenAI:searchOpenAIFiles] RETRY: ${getFilesRestEndpoint} ${error.message}`);
                    await delay(1000);
                    continue;
                }
                console.error(`[OpenAI:searchOpenAIFiles] FAILED: ${getFilesRestEndpoint} ${error.message}`);
                throw error;
            }
            break;
        }
        if (!response) {
            console.error(`[OpenAI:searchOpenAIFiles] FAILED ${JSON.stringify(criteria)}: No response`);
            throw new Error('Failed to fetch files');
        }

        const searchResult = await response.json() as FileSearchResult;

        const data = searchResult.data as OpenAIFile[];

        if (data.length === 0) {
            break; // No more files to fetch
        }

        page++;

        // log out the currenttime, the size of the current slice, the starting id and created_at
        //      (in pretty local time format) of the first and last files
        const currentTime = usFormatter.format(new Date());
        const filesPerSecond = data.length / (ascending?(data[data.length - 1].created_at - data[0].created_at):(data[0].created_at - data[data.length - 1].created_at));

        console.log(`[OpenAI:searchOpenAIFiles] SUCCESS: Fetched Page ${page} - ${data.length} files : ${Math.round(filesPerSecond * 100) / 100}` +
                    ` files/sec : starts: ${data[0].id} (${new Date(data[0].created_at * 1000).toLocaleString()}) : ends: ` +
                    `${data[data.length - 1].id} (${new Date(data[data.length - 1].created_at * 1000).toLocaleString()})`);

        let skipped = 0;
        for (const file of data) {
            // Stop fetching and filtering if a file earlier than creationStart is found
            if (creationStart && file.created_at < creationStart) {
                skipped++;
                if (ascending) {
                    continue; // Skip this file
                }
                console.warn(`[OpenAI:searchOpenAIFiles] SKIPPED: ${file.filename} created at: ${file.created_at} before ${new Date(creationStart * 1000).toLocaleString()}`);
                return filterFiles(files); // Return current files without adding more
            }
            // Apply filePrefixFilter if present
            if (filePrefixFilter && !file.filename.startsWith(filePrefixFilter)) {
                continue; // Skip this file
            }
            files.push(file);
            if (files.length >= actualLimit) {
                break; // Respect the limit if specified
            }
        }

        totalFetched += data.length;
        lastFileId = data[data.length - 1]?.id;

        if (skipped > 0) {
            console.warn(`[OpenAI:searchOpenAIFiles] SKIPPED: ${skipped} files before ${new Date(data[0].created_at * 1000).toLocaleString()}`);
        }

        // If a limit is specified and reached, or no more files to fetch, stop the loop
    } while (files.length < actualLimit && lastFileId && totalFetched < actualLimit);

    return filterFiles(files.slice(0, actualLimit)); // Ensure only the limited number of files are returned
};

export interface OpenAIAssistant {
  id: string; // The identifier, which can be referenced in API endpoints.
  object: string; // The object type, which is always "assistant".
  created_at: number; // The Unix timestamp (in seconds) for when the assistant was created.
  name: string | null; // The name of the assistant. The maximum length is 256 characters.
  description: string | null; // The description of the assistant. The maximum length is 512 characters.
  model: string; // ID of the model to use.
  instructions: string | null; // The system instructions that the assistant uses. The maximum length is 32768 characters.
  tools: OpenAITool[]; // A list of tool enabled on the assistant.
  file_ids: string[]; // A list of file IDs attached to this assistant.
  metadata: Record<string, string>; // Set of 16 key-value pairs that can be attached to an object.
}

type OpenAITool = {
  // Assuming a simplified structure for the tool object. You might need to adjust according to the actual API response.
  type: "code_interpreter" | "retrieval" | "function";
};

export interface OpenAIAssistantQuery {
    object: string;
    data: OpenAIAssistant[];
    first_id: string;
    last_id: string;
    has_more: boolean;
}

export const getOpenAIAssistant = async (assistantId: string): Promise<OpenAIAssistant | undefined> => {
    const openAiKey : any = await getSecretsAsObject('exetokendev', 'openai-personal');
    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const getAssistantIdRest = `https://api.openai.com/v1/assistants/${assistantId}`;

    const axiosConfig = {
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
            'OpenAI-Beta': 'assistants=v1',
        },
        timeout: 2000, // 2 second timeout
    };

    // Retry logic
    const maxRetries = 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            const response = await axios.get(getAssistantIdRest, axiosConfig);
            return response.data as OpenAIAssistant;
        } catch (error: any) {
            if (error?.response.status === 404) {
                return undefined;
            } else if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
                attempt++;
                if (attempt > maxRetries) {
                    throw new Error(`Failed to fetch ${assistantId} after ${maxRetries + 1} attempts due to timeout.`);
                }
                const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';

                console.warn(`[OpenAI:getOpenAIAssistant] RETRY ${attempt} for ${assistantId} after Error: ${error.message} - ${errorDetails}`);
            } else {
                console.error(`[OpenAI:getOpenAIAssistant] FAILED: ${assistantId} after Error: ${error.message}`);
                // Handle non-timeout errors
                if (error.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    const errorMessage = error.response.data.error?.message || 'No error message';
                    const statusCode = error.response.status;
                    if (statusCode === HTTP_FAILURE_BUSY) {
                        throw new Error(`OpenAI Get Call Rate limit exceeded for ${assistantId}: ${errorMessage}`);
                    } else {
                        throw new Error(`OpenAI Get Assistant failure for ${assistantId} status: ${statusCode}, error: ${errorMessage}`);
                    }
                } else if (error.request) {
                    // The request was made but no response was received
                    throw new Error(`OpenAI Get Assistant failure for ${assistantId}: No response from server`);
                } else {
                    // Something happened in setting up the request that triggered an Error
                    throw new Error(`Error fetching Assistant ${assistantId}: ${error.message}`);
                }
            }
        }
    }
    return undefined;
}

export const deleteOpenAIAssistant = async (assistantId: string): Promise<void> => {
    const openAiKey : any = await getSecretsAsObject('exetokendev', 'openai-personal');
    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const deleteAssistantIdRest = `https://api.openai.com/v1/assistants/${assistantId}`;

    const axiosConfig = {
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
            'OpenAI-Beta': 'assistants=v1',
        },
        timeout: 2000, // 2 second timeout
    };

    // Retry logic
    const maxRetries = 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            await axios.delete(deleteAssistantIdRest, axiosConfig);

            // If call was successful, break out of the loop
            return;
        } catch (error: any) {
            if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
                attempt++;
                if (attempt > maxRetries) {
                    throw new Error(`Failed to delete ${assistantId} after ${maxRetries + 1} attempts due to timeout.`);
                }
                const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';
                console.warn(`[OpenAI:deleteOpenAIAssistant] RETRY ${attempt} for ${assistantId} after Error: ${error.message} - ${errorDetails}`);
            } else {
                console.error(`[OpenAI:deleteOpenAIAssistant] FAILED: ${assistantId} after Error: ${error.message}`);
                // Handle non-timeout errors
                if (error.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    const errorMessage = error.response.data.error?.message || 'No error message';
                    const statusCode = error.response.status;
                    if (statusCode === HTTP_FAILURE_BUSY) {
                        throw new Error(`OpenAI Delete Call Rate limit exceeded for ${assistantId}: ${errorMessage}`);
                    } else {
                        throw new Error(`OpenAI Delete assistant failure for ${assistantId} status: ${statusCode}, error: ${errorMessage}`);
                    }
                } else if (error.request) {
                    // The request was made but no response was received
                    throw new Error(`OpenAI Delete assistant failure for ${assistantId}: No response from server`);
                } else {
                    // Something happened in setting up the request that triggered an Error
                    throw new Error(`Error deleting assistant ${assistantId}: ${error.message}`);
                }
            }
        }
    }
};

export const searchOpenAIAssistants = async (searchCriteria: DataSearchCriteria, assistantHandler?: any): Promise<OpenAIAssistant[]> => {
    const openAiKey : any = await getSecretsAsObject('exetokendev', 'openai-personal');
    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const { email, org, project } = searchCriteria;

    const searchParameters = `email:${email?email:"ANY"}, org:${org?org:"ANY"}, project:${project?project:"ANY"}}`;

    const currentTime = usFormatter.format(new Date());

    let afterCursor: string | undefined;
    let allAssistants: OpenAIAssistant[] = [];

    let pageSize = 5;

    do {
        const getAssistantsRestEndpoint = `https://api.openai.com/v1/assistants?limit=${pageSize}${afterCursor ? `&after=${afterCursor}` : ''}`;
        const response = await fetch(getAssistantsRestEndpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${openAiKey}`,
                'OpenAI-Beta': 'assistants=v1',
            },
        });

        if (!response.ok) {

            const errorText = await response.text();

            console.log(`[OpenAI:searchOpenAIAssistants] FAILED: ${errorText} : ${searchParameters}`);
        
            let errorObj = undefined;
            try {
                errorObj = errorText ? JSON.parse(errorText) : null;
        
                // Check if the error is due to rate limiting
                if (response.status === HTTP_FAILURE_BUSY && errorObj && errorObj.error && errorObj.error.code === "rate_limit_exceeded") {
                    throw new Error(`Rate limit exceeded: ${errorObj.error.message}`);
                } else {
                    // For other errors, include the original error message
                    throw new Error(`OpenAI Assistant Search failure for ${searchParameters} status: ${response.status}, error: ${errorText}`);
                }
            } catch (error: any) {
                // check if JSON.parse failed
                if (error instanceof SyntaxError) {
                    // Handle JSON parsing error
                    throw new Error(`Error parsing response from OpenAI for ${searchParameters}: ${error.message}`);
                } else {
                    // Rethrow the original error if it's not a parsing error
                    throw new Error(`OpenAI Assistant Search failure for ${searchParameters} status: ${response.status}, error: ${errorObj?JSON.stringify(errorObj):errorText} - cascading error: ${error}`);
                }
            }
        }

        const queryReply = await response.json() as OpenAIAssistantQuery;
        allAssistants = allAssistants.concat(queryReply.data);
        if (queryReply.has_more !== undefined && !queryReply.has_more) {
            break;
        }
        afterCursor = queryReply.last_id;
    } while (afterCursor);

    console.log(`[OpenAI:searchOpenAIAssistants] SUCCEEDED: ${allAssistants.length} Assistants : ${searchParameters}`);

    const ASSISTANT_METADATA_CREATOR = 'sara.frontend'

    const assistantMetadataToMatch = {
        projectId: project,
        userName: email,
        orgName: org,
        creator: ASSISTANT_METADATA_CREATOR,
    }

    let filteredAssistants = allAssistants.filter((assistant: OpenAIAssistant) => {
        let isMatch = true;

        if (assistantMetadataToMatch.creator && assistant.metadata.creator) {
            isMatch &&= assistant.metadata.creator === assistantMetadataToMatch.creator;
        }

        if (isMatch && assistantMetadataToMatch.userName && assistant.metadata.userName) {
            isMatch &&= assistant.metadata.userName === assistantMetadataToMatch.userName;
        }

        if (isMatch && assistantMetadataToMatch.orgName && assistant.metadata.orgName) {
            isMatch &&= assistant.metadata.orgName === assistantMetadataToMatch.orgName;
        }

        if (isMatch && assistantMetadataToMatch.projectId && assistant.metadata.projectId) {
            isMatch &&= assistant.metadata.projectId === assistantMetadataToMatch.projectId;
        }
        
        if (!isMatch) {
            return false;
        }
        return true;
    });

    if (assistantHandler) {
        async function filterAsync(array: any, predicate: any) {
            const filteredArray = [];
            for (const item of array) {
                if (await predicate(item)) {
                    filteredArray.push(item);
                }
            }
            return filteredArray;
        }
                
        // Usage
        filteredAssistants = await filterAsync(filteredAssistants, assistantHandler);
    }

    return filteredAssistants;
};

interface FileSearchResult {
    data: OpenAIFile[];
    object: string;
    has_more: boolean;
    last_id: string;
    first_id: string;
}

export const deleteOpenAIFiles = async (searchCriteria: DataSearchCriteria, shouldDeleteHandler?: any): Promise<OpenAIFile[]> => {

    const { email, org, project, repoUri, dataType, limit, creationStart, startAtFileId, filePrefixFilter } = searchCriteria;

    const searchParameters = `email:${email?email:"ANY"}, org:${org?org:"ANY"}, project:${project?project:"ANY"}, repoUri:${repoUri?repoUri:"ANY"}, dataType:${dataType?dataType:"ANY"}`;

    const startTime = Date.now() / 1000;
    const currentTime = usFormatter.format(new Date(startTime * 1000));

    console.info(`${currentTime} deleteOpenAIFiles:STARTED: ${searchParameters}`);

    const filesDeleted : OpenAIFile[] = [];

    let page = 1;

    const deleteFilesHandler = async (deleteTheseFiles: OpenAIFile[]) => {
        const totalFilesToDelete = deleteTheseFiles.length;
        const deleteStartTime = Date.now() / 1000;
        let deletedFilesInThisPage : number = 0;
        while (deleteTheseFiles.length > 0) {

            // get the next 20 files out of the list
            const filesToProcess = deleteTheseFiles.splice(0, 20);

            for (const file of filesToProcess) {
                const beforeDeleteTimeInMs = Date.now();

                try {
                    await deleteAssistantFile(file.id);
                    filesDeleted.push(file);
                    deletedFilesInThisPage++;

                    const percentageOfFilesDeletedTo2DecimalPlaces = parseFloat(((deletedFilesInThisPage / totalFilesToDelete) * 100).toFixed(2));

                    const createdTime = usFormatter.format(new Date(file.created_at * 1000));
                    console.debug(`[OpenAI:deleteOpenAIFiles]  SUCCESS:${deletedFilesInThisPage}/${totalFilesToDelete} ${percentageOfFilesDeletedTo2DecimalPlaces}% : Groom/Deleted:${file.filename} : id:${file.id} : created at:${createdTime} : bytes:${file.bytes} : purpose:${file.purpose}`);

                    const afterDeleteTimeInMs = Date.now();

                    // we need to wait one second between calls, so calculate the remaining time out of one second
                    //      since beforeDeleteTimeInMs is in milliseconds, we need to divide by 1000 to get seconds
                    //      and then subtract the time it took to delete the file
                    const remainingTimeInSeconds = 1000 - (afterDeleteTimeInMs - beforeDeleteTimeInMs);
                    if (remainingTimeInSeconds >= 0) {
                        await delay(remainingTimeInSeconds);
                    }
                } catch (error: any) {
                    const currentTime = usFormatter.format(new Date());
                    console.warn(`[OpenAI:deleteOpenAIFiles] FAILED: deleting ${file.filename} : id: ${file.id} : ${error.message}`);
                }
            }

            const currentTime = Date.now(); // Current time in milliseconds
            const timeElapsedInSeconds = (currentTime / 1000) - deleteStartTime;
    
            const currentDateTime = usFormatter.format(new Date(currentTime));
            if (startAtFileId) {
                console.debug(`${currentDateTime} deleteOpenAIFiles:PROCESSING: Page:${page} : Deleted ${deletedFilesInThisPage} files in ${Math.round(timeElapsedInSeconds * 100) / 100} seconds at a rate of ${Math.round(deletedFilesInThisPage / timeElapsedInSeconds * 10000) / 10000} file/sec`);
            } else {
    
                const percentageOfFilesDeletedTo2DecimalPlaces = parseFloat(((deletedFilesInThisPage / totalFilesToDelete) * 100).toFixed(2));
                const remainingTimeInSeconds = (1 / (percentageOfFilesDeletedTo2DecimalPlaces / 100)) * timeElapsedInSeconds;
        
                const estimatedDateTime = usFormatter.format(new Date(currentTime + (remainingTimeInSeconds * 1000)));

                console.debug(`${currentDateTime} deleteOpenAIFiles:PROCESSING: Deleted ${deletedFilesInThisPage} files in ${Math.round(timeElapsedInSeconds * 100) / 100} seconds at a rate of ${Math.round(deletedFilesInThisPage / timeElapsedInSeconds * 10000) / 10000} file/sec : ${percentageOfFilesDeletedTo2DecimalPlaces}% complete : estimated completion at ${estimatedDateTime}`);
            }
        }
    }

    // if process everything in one big search and sweep
    if (!startAtFileId) {

        const searchStartTime = Date.now() / 1000;
        const retrievedFiles : OpenAIFile[] = await searchOpenAIFiles(searchCriteria);

        const searchDate = usFormatter.format(new Date());

        const deletionTime = Date.now() / 1000;
        const callTimeInSeconds = deletionTime - searchStartTime;

        const filesToDelete = retrievedFiles.filter((file) => {
            return shouldDeleteHandler(file);
        });

        console.log(`[OpenAI:deleteOpenAIFiles:SearchFiles] SUCCEEDED (${callTimeInSeconds} seconds): ${retrievedFiles.length} files: filtered to ${filesToDelete.length}`);

        await deleteFilesHandler(filesToDelete);
    } else {
        while (true) {
            const searchStartTime = Date.now() / 1000;
            searchCriteria.limit = 1000;
            const retrievedFiles : OpenAIFile[] = await searchOpenAIFiles(searchCriteria);

            const searchDate = usFormatter.format(new Date());

            const deletionTime = Date.now() / 1000;
            const callTimeInSeconds = deletionTime - searchStartTime;

            const filesToDelete = retrievedFiles.filter((file) => {
                return shouldDeleteHandler(file);
            });

            console.log(`[OpenAI:deleteOpenAIFiles:SearchFiles] SUCCEEDED (${callTimeInSeconds} seconds): ${retrievedFiles.length} files: filtered to ${filesToDelete.length} - ${searchParameters}`);

            await deleteFilesHandler(filesToDelete);

            if (retrievedFiles.length < 1000) {
                break;
            }
            page++;
        }
    }


    const deleteEndTime = Date.now() / 1000;

    console.log(`[OpenAI:deleteOpenAIFiles] SUCCESS (${deleteEndTime - startTime} seconds): ${filesDeleted.length} - ${searchParameters}`);

    return filesDeleted;

};
