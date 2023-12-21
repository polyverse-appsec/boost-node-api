import { Request, Response } from 'express';
import { SourceType, storeProjectData } from './storage';
import { getSecrets, getSecret } from './secrets';

import fetch from 'node-fetch';
import FormData from 'form-data';

export async function store_vectordata_for_project(email: string, uri: URL, vectorData: string, req: Request, res: Response) : Promise<Response> {

    if (!vectorData) {
        res.status(400).send('Invalid vector data');
        throw new Error('Invalid vector data');
    }

    console.log(`store_vectordata_for_project: vectorData received`);

    // Split the pathname by '/' and filter out empty strings
    const pathSegments = uri.pathname.split('/').filter(segment => segment);

    // The relevant part is the last segment of the path
    const repoName = pathSegments.pop();
    const ownerName = pathSegments.pop();
    if (!repoName || !ownerName) {
        console.error(`Invalid URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const vectorDataType = 'vectordata';

    const vectorDataId = await createAssistantFile(`allfiles_concat`, vectorData);
    
    // we store the project data under the owner (instead of email) so all users in the org can see the data
    await storeProjectData(ownerName, SourceType.GitHub, ownerName, repoName, '', `${vectorDataType}:4:id`, vectorDataId);

    // return a list of assistant file resource id
    const assistantFileResourceIds = [];

    // add a single faux id for now - until we call the OpenAI assistant file creation api
    assistantFileResourceIds.push(vectorDataId);

    // send result as a JSON string in the body
    res.header('Content-Type', 'application/json');

    console.log(`store_vectordata_for_project: vectorData stored`);

    return res.status(200).send(JSON.stringify(assistantFileResourceIds));
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

const createAssistantFile = async (dataId: string, data: string): Promise<string> => {
    const secretData : any = getSecret('exetokendev');
    console.log(`secrets: ${JSON.stringify(secretData)}`)
    let openAiKey = secretData['openai-personal']?secretData['openai-personal']:'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';

    if (!openAiKey) {
        throw new Error('OpenAI API key not found');
    }

    const url = 'https://api.openai.com/v1/files';

    const filename = `${dataId}.jsonl`;

    const formData = new FormData();
    formData.append('purpose', 'assistants');
    formData.append('file', Buffer.from(data), filename);

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