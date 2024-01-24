import { Request, Response } from 'express';
import { SourceType, storeProjectData } from './storage';
import { getSingleSecret, getSecretsAsObject as getSecretsAsObject } from './secrets';
import { ProjectDataReference } from './types/ProjectDataReference';

import fetch from 'node-fetch';
import FormData from 'form-data';

export async function uploadProjectDataForAIAssistant(projectName: string, uri: URL, dataTypeId: string, simpleFilename: string, projectData: string) : Promise<ProjectDataReference> {

    if (!projectData) {
        throw new Error('Invalid project data');
    }

    console.log(`store_data_for_project: projectData received`);

    // Split the pathname by '/' and filter out empty strings
    const pathSegments = uri.pathname.split('/').filter(segment => segment);

    // The relevant part is the last segment of the path
    const repoName = pathSegments.pop();
    const ownerName = pathSegments.pop();
    if (!repoName || !ownerName) {
        throw new Error(`Invalid URI: ${uri}`);
    }

    const projectQualifiedFullFilename = `${projectName}_${generateFilenameFromGitHubProject(ownerName, repoName)}_${simpleFilename}`;
    console.log(`store_data_for_project: AI file resource name: ${projectQualifiedFullFilename}`);
    const openAiFile : OpenAIFileUploadResponse = await createAssistantFile(projectQualifiedFullFilename, projectData);

    const dataResource : ProjectDataReference = {
        name: `${projectQualifiedFullFilename}`,
        type: `${dataTypeId}`,
        id: openAiFile.id,
        // return current time in unix system time format
        last_updated: openAiFile.created_at,
    }

    return dataResource;
}

function generateFilenameFromGitHubProject(part1: string, part2: string): string {
    // Replace any non-alphanumeric characters (including dots) with underscores
    const safePart1 = part1.replace(/[^a-zA-Z0-9]/g, '_');
    const safePart2 = part2.replace(/[^a-zA-Z0-9]/g, '_');

    // Combine the parts with an underscore
    return `${safePart1}_${safePart2}`;
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

const createAssistantFile = async (dataFilename: string, data: string): Promise<OpenAIFileUploadResponse> => {
    const secretData : any = await getSecretsAsObject('exetokendev');
    let openAiKey = secretData['openai-personal'];

    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const url = 'https://api.openai.com/v1/files';

    const dataSize = Buffer.byteLength(data, 'utf8');
    console.log(`createAssistantFile for (${dataSize} bytes): ${dataFilename}`);

    const formData = new FormData();
    formData.append('purpose', 'assistants');
    formData.append('file', Buffer.from(data), { filename: dataFilename} as FormData.AppendOptions);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAiKey}`,
            ...formData.getHeaders(),
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error(`OpenAI Upload failure for ${dataFilename} status: ${response.status}`);
    }

    const responseData: OpenAIFileUploadResponse = await response.json() as OpenAIFileUploadResponse;
    return responseData; // Return only the id from the response
};