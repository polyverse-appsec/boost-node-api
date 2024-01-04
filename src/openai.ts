import { Request, Response } from 'express';
import { SourceType, storeProjectData } from './storage';
import { getSecret } from './secrets';
import { ProjectDataReference } from './types/ProjectDataReference';

import fetch from 'node-fetch';
import FormData from 'form-data';

export async function uploadProjectDataForAIAssistant(projectName: string, uri: URL, dataTypeId: string, dataName: string, projectData: string, req: Request, res: Response) : Promise<any> {

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

    const dataNameWithGitHubProjectPrefix = `${projectName}_${generateFilenameFromGitHubProject(ownerName, repoName)}_${dataName}`;
    console.log(`store_data_for_project: proposed AI file resource name: ${dataNameWithGitHubProjectPrefix}`);
    console.log(`store_data_for_project: actual AI file resource name: ${dataName}`);
    const openAiFileId = await createAssistantFile(dataNameWithGitHubProjectPrefix, projectData);

    const dataResource : ProjectDataReference = {
        name: `${dataNameWithGitHubProjectPrefix}`,
        type: `${dataTypeId}`,
        id: openAiFileId,
        // return current time in unix system time format
        last_updated: Math.floor(Date.now() / 1000)
    }

    // we store the project data under the owner (instead of email) so all users in the org can see the data
    await storeProjectData(ownerName, SourceType.GitHub, ownerName, repoName, '', `${dataTypeId}:4:id`, openAiFileId);

    console.log(`store_data_for_project: projectData stored`);

    return dataResource;
}

function generateFilenameFromGitHubProject(part1: string, part2: string): string {
    // Replace any non-alphanumeric characters (including dots) with underscores
    const safePart1 = part1.replace(/[^a-zA-Z0-9]/g, '_');
    const safePart2 = part2.replace(/[^a-zA-Z0-9]/g, '_');

    // Combine the parts with an underscore
    return `${safePart1}_${safePart2}`;
}

interface OpenAIFileUploadResponse {
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

const createAssistantFile = async (dataFilename: string, data: string): Promise<string> => {
    const secretData : any = getSecret('exetokendev');
    console.log(`secrets: ${JSON.stringify(secretData)}`)
    let openAiKey = secretData['openai-personal']?secretData['openai-personal']:'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';

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
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseData: OpenAIFileUploadResponse = await response.json() as OpenAIFileUploadResponse;
    return responseData.id; // Return only the id from the response
};