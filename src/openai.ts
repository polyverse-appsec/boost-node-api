import { getSecretsAsObject as getSecretsAsObject } from './secrets';
import { ProjectDataReference } from './types/ProjectDataReference';

import { usFormatter } from './utility/log';

import fetch from 'node-fetch';
import FormData from 'form-data';
import { error } from 'console';
import { Url } from 'url';
import { start } from 'repl';

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

    const projectName = `${org}_${project}`;
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
    const safeSimpleFilename = simpleFilename.replace(/[^a-zA-Z0-9]/g, '_');

    // Combine the parts with an underscore
    return `${safeEmail}_${safeOrg}__${safeProject}__${safeOwnerName}_${safeRepoName}__${safeSimpleFilename}`;
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

const createAssistantFile = async (dataFilename: string, data: string): Promise<OpenAIFile> => {
    const secretData : any = await getSecretsAsObject('exetokendev');
    let openAiKey = secretData['openai-personal'];

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
        console.warn(`SIMULATED: OpenAI file upload: ${simulatedFileData.id} ${simulatedFileData.filename} at ${simulatedFileData.created_at} bytes: ${simulatedFileData.bytes}`);

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
        console.log(`${currentTime} createAssistantFile:UPLOAD:SUCEEDED: ${dataFilename} (${dataSize} bytes)`);

        const responseData: OpenAIFile = await response.json() as OpenAIFile;
        responseData.created_at = Date.now() / 1000; // store our own timestamp so we're sure time comparisons are consistent
        return responseData;
    }

    const errorText = await response.text();
    console.log(`${currentTime} createAssistantFile:UPLOAD:FAILED(${response.status}): ${dataFilename} (${dataSize} bytes) due to error ${errorText}; Headers:${JSON.stringify(response.headers)}`);

    let errorObj = undefined;
    try {
        errorObj = errorText ? JSON.parse(errorText) : null;

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
            throw new Error(`OpenAI Upload failure for ${dataFilename} status: ${response.status}, error: ${errorObj?JSON.stringify(errorObj):errorText} - cascading error: ${error}`);
        }
    }
};

export const deleteAssistantFile = async (fileId: string): Promise<void> => {
    const secretData : any = await getSecretsAsObject('exetokendev');
    let openAiKey = secretData['openai-personal'];

    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const deleteFileIdRest = `https://api.openai.com/v1/files/${fileId}`;

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

export const searchOpenAIFiles = async (email?: string, org?: string, project?: string, repoUri?: URL, dataType?: string): Promise<OpenAIFile[]> => {
    const secretData : any = await getSecretsAsObject('exetokendev');
    let openAiKey = secretData['openai-personal'];

    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const getFilesRestEndpoint = 'https://api.openai.com/v1/files';

    const currentTime = usFormatter.format(new Date());
    const response = await fetch(getFilesRestEndpoint, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
        },
    });

    const searchParameters = `email:${email?email:"ANY"}, org:${org?org:"ANY"}, project:${project?project:"ANY"}, repoUri:${repoUri?repoUri:"ANY"}, dataType:${dataType?dataType:"ANY"}`;

    if (response.ok) {

        const retrievedFiles: OpenAIFile[] = (await response.json()).data as OpenAIFile[];

        console.log(`${currentTime} searchOpenAIFiles:SUCCEEDED: ${retrievedFiles.length} files : ${searchParameters}`);

        // Split the pathname by '/' and filter out empty strings
        const pathSegments = !repoUri?undefined:repoUri.pathname!.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments?pathSegments.pop():undefined;
        const ownerName = pathSegments?pathSegments.pop():undefined;
        
        const filteredFiles = retrievedFiles.filter((file) => {
            let isMatch = true;
            if (email) {
                isMatch && file.filename.includes(`${email.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (org) {
                isMatch && file.filename.includes(`_${org.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (project) {
                isMatch && file.filename.includes(`_${project.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (repoName) {
                isMatch && file.filename.includes(`${repoName.toString().replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (ownerName) {
                isMatch && file.filename.includes(`${ownerName.toString().replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (dataType) {
                isMatch && file.filename.includes(`${dataType}`);
            }
            return isMatch;
        });

        return filteredFiles;
    }

    const errorText = await response.text();

    console.log(`${currentTime} searchOpenAIFiles:FAILED: ${errorText} : ${searchParameters}`);

    let errorObj = undefined;
    try {
        errorObj = errorText ? JSON.parse(errorText) : null;

        // Check if the error is due to rate limiting
        if (response.status === 429 && errorObj && errorObj.error && errorObj.error.code === "rate_limit_exceeded") {
            throw new Error(`Rate limit exceeded: ${errorObj.error.message}`);
        } else {
            // For other errors, include the original error message
            throw new Error(`OpenAI Search failure for ${searchParameters} status: ${response.status}, error: ${errorText}`);
        }
    } catch (error: any) {
        // check if JSON.parse failed
        if (error instanceof SyntaxError) {
            // Handle JSON parsing error
            throw new Error(`Error parsing response from OpenAI for ${searchParameters}: ${error.message}`);
        } else {
            // Rethrow the original error if it's not a parsing error
            throw new Error(`OpenAI Search failure for ${searchParameters} status: ${response.status}, error: ${errorObj?JSON.stringify(errorObj):errorText} - cascading error: ${error}`);
        }
    }
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

export const searchOpenAIAssistants = async (email?: string, org?: string, project?: string, activeFileHandler?: any): Promise<OpenAIAssistant[]> => {
    const secretData : any = await getSecretsAsObject('exetokendev');
    let openAiKey = secretData['openai-personal'];

    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const searchParameters = `email:${email?email:"ANY"}, org:${org?org:"ANY"}, project:${project?project:"ANY"}}`;

    const currentTime = usFormatter.format(new Date());

    let afterCursor: string | undefined;
    let allAssistants: OpenAIAssistant[] = [];

    do {
        const getAssistantsRestEndpoint = `https://api.openai.com/v1/assistants?limit=100${afterCursor ? `&after=${afterCursor}` : ''}`;
        const response = await fetch(getAssistantsRestEndpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${openAiKey}`,
                'OpenAI-Beta': 'assistants=v1',
            },
        });

        if (!response.ok) {

            const errorText = await response.text();

            console.log(`${currentTime} searchOpenAIAssistants:FAILED: ${errorText} : ${searchParameters}`);
        
            let errorObj = undefined;
            try {
                errorObj = errorText ? JSON.parse(errorText) : null;
        
                // Check if the error is due to rate limiting
                if (response.status === 429 && errorObj && errorObj.error && errorObj.error.code === "rate_limit_exceeded") {
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
        afterCursor = queryReply.last_id;
    } while (afterCursor);

    console.log(`${currentTime} searchOpenAIAssistants:SUCCEEDED: ${allAssistants.length} files : ${searchParameters}`);

    const filteredAssistants = allAssistants.filter((assistant: OpenAIAssistant) => {
        let isMatch = true;
/*
        if (email) {
            isMatch && assistant.name?.includes(`${email.replace(/[^a-zA-Z0-9]/g, '_')}`);
        }
*/
        if (isMatch && org) {
            isMatch && assistant.name?.includes(`_${org.replace(/[^a-zA-Z0-9]/g, '_')}`);
        }
        if (isMatch && project) {
            isMatch && assistant.metadata.projectName?.includes(`_${project.replace(/[^a-zA-Z0-9]/g, '_')}`);
        }
        if (!isMatch) {
            console.warn(`Assistant: ${assistant.name} should be excluded based on filter; but Assistant creation is not yet filtered by project, org, or email.`)
        }
        return true;
    });

    if (activeFileHandler) {
        filteredAssistants.forEach(assistant => {
            activeFileHandler(assistant.file_ids);
        });
    }

    return filteredAssistants;
};

export const deleteOpenAIFiles = async (email?: string, org?: string, project?: string, repoUri?: URL, dataType?: string, groomHandler?: any): Promise<OpenAIFile[]> => {
    const secretData : any = await getSecretsAsObject('exetokendev');
    let openAiKey = secretData['openai-personal'];

    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const getFilesRestEndpoint = 'https://api.openai.com/v1/files';

    const startTime = Date.now() / 1000;
    const currentTime = usFormatter.format(new Date(startTime));

    const response = await fetch(getFilesRestEndpoint, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
        },
    });

    const deletionTime = Date.now() / 1000;
    const callTimeInSeconds = deletionTime - startTime;
    const searchParameters = `email:${email?email:"ANY"}, org:${org?org:"ANY"}, project:${project?project:"ANY"}, repoUri:${repoUri?repoUri:"ANY"}, dataType:${dataType?dataType:"ANY"}`;

    if (response.ok) {

        const retrievedFiles: OpenAIFile[] = (await response.json()).data as OpenAIFile[];

        console.log(`${currentTime} deleteOpenAIFiles:SUCCEEDED (${callTimeInSeconds} seconds): ${retrievedFiles.length} files : ${searchParameters}`);

        // Split the pathname by '/' and filter out empty strings
        const pathSegments = !repoUri?undefined:repoUri.pathname!.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments?pathSegments.pop():undefined;
        const ownerName = pathSegments?pathSegments.pop():undefined;
        
        const filesToDelete = retrievedFiles.filter((file) => {
            let isMatch = true;
            if (email) {
                isMatch && file.filename.includes(`${email.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (org && isMatch) {
                isMatch && file.filename.includes(`_${org.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (project && isMatch) {
                isMatch && file.filename.includes(`_${project.replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (repoName && isMatch) {
                isMatch && file.filename.includes(`${repoName.toString().replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (ownerName && isMatch) {
                isMatch && file.filename.includes(`${ownerName.toString().replace(/[^a-zA-Z0-9]/g, '_')}`);
            }
            if (dataType && isMatch) {
                isMatch && file.filename.includes(`${dataType}`);
            }
            if (groomHandler && isMatch) {
                isMatch && groomHandler(file);
            }
            return isMatch;
        });

        const filesDeleted : OpenAIFile[] = [];
        const deleteStartTime = Date.now() / 1000;
        while (filesToDelete.length > 0) {
            // get the next 20 files out of the list
            const filesToProcess = filesToDelete.splice(0, 20);

            if (process.env.PARALLEL_DELETE) {
                // Start the deletion of all 20 files, then we'll wait for them to complete
                const deletePromises = filesToProcess.map(file => deleteAssistantFile(file.id)
                    .then(() => {
                        filesDeleted.push(file); // Only push if deletion was successful
                    })
                    .catch(error => {
                        const currentTime = usFormatter.format(new Date());
                        // Log error without interrupting the batch process
                        console.warn(`${currentTime} deleteOpenAIFiles:FAILED: deleting ${file.filename} : id: ${file.id} : ${error.message}`);
                    })
                );
                await Promise.all(deletePromises);
            } else {
                for (const file of filesToProcess) {
                    // wait 1.5 seconds to throttle AI calls - so we don't get blocked by OpenAI server
                    await delay(1500);

                    try {
                        await deleteAssistantFile(file.id);
                        filesDeleted.push(file);
                        console.debug(`deleteOpenAIFiles:SUCCESS: Groom/Deleted ${file.filename} : id: ${file.id}`);
                    } catch (error: any) {
                        const currentTime = usFormatter.format(new Date());
                        console.warn(`${currentTime} deleteOpenAIFiles:FAILED: deleting ${file.filename} : id: ${file.id} : ${error.message}`);
                    }
                }
            
            }
        }
        const deleteEndTime = Date.now() / 1000;
        const deletionLogTime = usFormatter.format(new Date(deleteEndTime));

        console.log(`${deletionLogTime} deleteOpenAIFiles:SUCCESS (${deleteEndTime - deleteStartTime} seconds): ${filesDeleted.length}`);

        return filesDeleted;
    }

    const errorText = await response.text();

    console.log(`${currentTime} deleteOpenAIFiles:FAILED (${callTimeInSeconds}): ${errorText} : ${searchParameters}`);

    let errorObj = undefined;
    try {
        errorObj = errorText ? JSON.parse(errorText) : null;

        // Check if the error is due to rate limiting
        if (response.status === 429 && errorObj && errorObj.error && errorObj.error.code === "rate_limit_exceeded") {
            throw new Error(`Rate limit exceeded: ${errorObj.error.message}`);
        } else {
            // For other errors, include the original error message
            throw new Error(`OpenAI Delete Files failure for ${searchParameters} status: ${response.status}, error: ${errorText}`);
        }
    } catch (error: any) {
        // check if JSON.parse failed
        if (error instanceof SyntaxError) {
            // Handle JSON parsing error
            throw new Error(`Error parsing response from OpenAI for ${searchParameters}: ${error.message}`);
        } else {
            // Rethrow the original error if it's not a parsing error
            throw new Error(`OpenAI Delete Files failure for ${searchParameters} status: ${response.status}, error: ${errorObj?JSON.stringify(errorObj):errorText} - cascading error: ${error}`);
        }
    }
};
