import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';

import serverless from 'serverless-http';
import {
    getProjectData,
    searchProjectData,
    storeProjectData,
    SourceType,
    convertToSourceType,
    deleteProjectData
} from './storage';
import { validateUser, signedAuthHeader, getSignedIdentityFromHeader, local_sys_admin_email, header_X_Signed_Identity } from './auth';
import {
    getFolderPathsFromRepo,
    getFileFromRepo,
    getFilePathsFromRepo,
    getDetailsFromRepo,
    getFullSourceFromRepo,
    RepoDetails
} from './github';
import { uploadProjectDataForAIAssistant } from './openai';
import { UserProjectData } from './types/UserProjectData';
import { GeneratorState, TaskStatus, Stages } from './types/GeneratorState';
import { ProjectResource } from './types/ProjectResource';
import axios, { AxiosResponse } from 'axios';
import { ProjectDataReference } from './types/ProjectDataReference';
import { Generator } from './generators/generator';

import { 
    defaultBoostIgnorePaths,
    boostFilterFiles,
    potentiallyUsefulTextFiles,
    defaultIgnoredFolders,
    binaryFilePatterns,
    textFilePatterns
} from './utility/fileConstants';
import { ProjectDataFilename, ProjectDataType } from './types/ProjectData';
import { BlueprintGenerator } from './generators/blueprint';
import { Services, Endpoints } from './boost-python-api/endpoints';
import { GeneratorProcessingError } from './generators/generator';
import { ProjectSourceGenerator } from './generators/projectsource';
import { ArchitecturalSpecificationGenerator } from './generators/aispec';

export const app = express();

// set limits to 1mb for text and 10mb for json
app.use(express.json({ limit: '10mb' })); // Make sure to use express.json middleware to parse json request body
app.use(express.text({ limit: '1mb' })); // Make sure to use express.text middleware to parse text request body

const api_root_endpoint : string = '/api';

/*
// Error handling middleware
app.use((err : any, req : Request, res : Response) => {
    console.error(`Request ${req} failed with error ${err}`);
    res.status(500).send('Internal Server Error');
});
*/

export async function localSelfDispatch<T>(
    email: string, originalIdentityHeader: string, initialRequest: Request,
    path: string, httpVerb: string, bodyContent?: any, timeoutMs: number = 0, throwOnTimeout: boolean = true): Promise<T> {

    let selfEndpoint = `${initialRequest.protocol}://${initialRequest.get('host')}${api_root_endpoint}/${path}`;
    // if we're running locally, then we'll use http:// no matter what
    if (initialRequest.get('host')!.includes('localhost')) {
        selfEndpoint = `http://${initialRequest.get('host')}${api_root_endpoint}/${path}`;
    }

    if (!timeoutMs) {

        const fetchOptions : RequestInit = {
            method: httpVerb,
            headers: {
                'X-Signed-Identity': originalIdentityHeader,
            }
        };

        if (['POST', 'PUT'].includes(httpVerb) && bodyContent) {
            fetchOptions.body = JSON.stringify(bodyContent);
            fetchOptions.headers = {
                ...fetchOptions.headers,
                'Content-Type': 'application/json'
            };
        }

        let response;
        
        try {
            response = await fetch(selfEndpoint, fetchOptions);
        } catch (error) {
            console.error(`Request ${httpVerb} ${selfEndpoint} failed with error ${error}`);
            throw error;
        }

        if (response.ok) {
            if (['GET'].includes(httpVerb)) {
                const objectResponse = await response.json();
                return (objectResponse.body?JSON.parse(objectResponse.body):objectResponse) as T;
            } else if (['POST', 'PUT', 'PATCH'].includes(httpVerb) && response.status === 200) {
                let objectResponse;
                try {
                    objectResponse = await response.json();
                } catch (error) {
                    console.error(`Request ${httpVerb} ${selfEndpoint} failed with error ${error}`);
                    return {} as T;
                }
                return (objectResponse.body?JSON.parse(objectResponse.body):objectResponse) as T;
            } else { // DELETE
                return {} as T;
            }
        }

        throw new Error(`Request ${selfEndpoint} failed with status ${response.status}: ${response.statusText}`);
    } else {
        const headers = {
            'X-Signed-Identity': originalIdentityHeader,
            'Content-Type': 'application/json'
        };
    
        const axiosConfig = {
            headers: headers,
            timeout: timeoutMs
        };
    
        try {
            let response;
            switch (httpVerb.toLowerCase()) {
                case 'get':
                    response = await axios.get(selfEndpoint, axiosConfig);
                    break;
                case 'post':
                    response = await axios.post(selfEndpoint, bodyContent, axiosConfig);
                    break;
                case 'put':
                    response = await axios.put(selfEndpoint, bodyContent, axiosConfig);
                    break;
                case 'delete':
                    response = await axios.delete(selfEndpoint, axiosConfig);
                    break;
                case 'patch':
                    response = await axios.patch(selfEndpoint, bodyContent, axiosConfig);
                    break;
                default:
                    throw new Error(`Invalid HTTP Verb: ${httpVerb}`);
            }
    
            // Axios automatically parses JSON, so no need to manually parse it here.
            return response.data as T;
        } catch (error : any) {
            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                console.log(`TIMECHECK: TIMEOUT: ${httpVerb} ${selfEndpoint} timed out after ${timeoutMs / 1000} seconds`);

                // if caller is launching an async process, and doesn't care about response, don't throw on timeout
                if (!throwOnTimeout) {
                    return {} as T;
                }
            } else {
                // This block is for handling errors, including 404 and 500 status codes
                if (axios.isAxiosError(error) && error.response) {
                    console.log(`TIMECHECK: ${httpVerb} ${selfEndpoint} failed with status ${error.response.status}:${error.response.statusText} due to error:${error}`);
                } else {
                    // Handle other errors (e.g., network errors)
                    console.log(`TIMECHECK: ${httpVerb} ${selfEndpoint} failed ${error}`);
                }
            }
            throw error;
        }
    }
}

async function splitAndStoreData(
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
    }
}

export async function saveProjectDataResource(
    email: string,
    ownerName: string,
    repoName: string,
    resource: string,
    path: string,
    data: any
): Promise<void> {
    await splitAndStoreData(email, SourceType.GitHub, ownerName, repoName, path, resource, data);
}

export async function loadProjectDataResource(
    email: string,
    ownerName: string,
    repoName: string,
    resource: string,
    path: string): Promise<string | undefined> {
    return await getCachedProjectData(email, SourceType.GitHub, ownerName, repoName, path, resource);
}

const logRequest = (req: Request) => {
    if (process.env.DEPLOYMENT_STAGE === 'dev') {
        console.log(`Request: ${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl}`);
    }
}

const handleErrorResponse = (error: any, req: Request, res: Response, supplementalErrorMessage: string = 'Error') : Response => {
    // Base error message with the request details
    const errorMessage = `UNHANDLED_ERROR(Response): ${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Check if we're in the development environment
    if (process.env.DEPLOYMENT_STAGE === 'dev' || process.env.DEPLOYMENT_STAGE === 'test' || process.env.DEPLOYMENT_STAGE === 'local'
        || process.env.DEPLOYMENT_STAGE === 'prod') {
        // In development, print the full error stack if available, or the error message otherwise
        console.error(`${supplementalErrorMessage} - ${errorMessage}`, error.stack || error);
        // Respond with the detailed error message for debugging purposes
        return res
            .status(500)
            .send(`Internal Server Error: ${supplementalErrorMessage} - ` + (error.stack || error));
    } else { // we'll use this for 'prod' and 'test' Stages in the future
        // In non-development environments, log the error message for privacy/security reasons
        console.error(`${supplementalErrorMessage} - ${errorMessage}`, error.message || error);
        // Respond with a generic error message to avoid exposing sensitive error details
        return res
            .status(500)
            .send(`Internal Server Error: ${supplementalErrorMessage} - ${errorMessage}` + (error.message || error));
    }
}

const postOrPutUserProjectDataResource = async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }

            return res.status(400).send('Invalid resource path');
        }

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }

        const uri = new URL(projectData.resources[0].uri);
        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            return res.status(400).send(`Invalid URI: ${uri}`);
        }

        // we store the project data under the owner (instead of email) so all users in the org can see the data
        // NOTE - we are storing the data for ONLY the first resource in the project (references are not included yet)
        // if req body is not a string, then we need to convert back into a normal string
        let body = req.body;
        if (typeof body !== 'string') {
            if (Buffer.isBuffer(body) || Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            }
        }

        if (body === '') {
            console.error(`${user_profile}: empty body`);
            return res.status(400).send('Missing body');
        }

        const { _, __, resource } = req.params;

        await saveProjectDataResource(email, ownerName, repoName, resource, '', body);

        const resourceStatus : ResourceStatusState = {
            last_updated: Math.floor(Date.now() / 1000)
        }

        await storeProjectData(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status", JSON.stringify(resourceStatus));

        console.log(`${user_project_org_project_data_resource}: stored data`);

        return res.status(200).send();
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
};

async function loadProjectData(email: string, org: string, project: string): Promise<UserProjectData | undefined> {
    let projectData = await getProjectData(email, SourceType.General, org, project, '', 'project');
    if (!projectData) {
        console.error(`loadProjectData: not found: ${org}/${project}`);
        return undefined;
    }
    projectData = JSON.parse(projectData) as UserProjectData;

    // create an object with the string fields, org, name, guidelines, array of string resources
    const userProjectData : UserProjectData = {
        org : org,
        name : project,
        guidelines : projectData.guidelines? projectData.guidelines : '',
        resources : projectData.resources? projectData.resources : [],
    };

    return projectData;
}

async function getCachedProjectData(email: string, sourceType: SourceType, ownerName: string, repoName: string, resourcePath: string, projectDataType: string): Promise<string | undefined> {
    let partNumber = 1;
    let projectData = await getProjectData(email, sourceType, ownerName, repoName, resourcePath, projectDataType);
    
    if (projectData) {
        return projectData;
    }

    if (await doesPartExist(email, ownerName, repoName, resourcePath, projectDataType, 1)) {
        let allData = '';
        while (true) {
            const partData = await getProjectData(email, sourceType, ownerName, repoName, resourcePath, `${projectDataType}:part-${partNumber}`);
            if (!partData) break;
            allData += partData;
            partNumber++;
        }
        projectData = allData;
    }

    return projectData;
}

// Helper function to check if a specific part exists
async function doesPartExist(email: string, ownerName: string, repoName: string, resourcePath: string, projectDataType: string, partNumber: number): Promise<boolean> {
    const partData = await getProjectData(email, SourceType.GitHub, ownerName, repoName, resourcePath, `${projectDataType}:part-${partNumber}`);
    return partData !== undefined;
}

function checkPrivateAccessAllowed(accountStatus: UserAccountState): boolean {
    return accountStatus.enabled && accountStatus.plan === 'premium';
}

const user_org_connectors_github_file = `user/:org/connectors/github/file`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_file}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            if (!req.query.repo && !req.query.path) {
                console.error(`URI is required`);
                return res.status(400).send('URI or Repo/Path is required');
            }
        }

        let uriString = req.query.uri as string;
        let repoString = req.query.repo as string;
        let pathString = req.query.path as string;

        let uri = undefined;
        let repo = undefined;
        let path: string = '';
        if (uriString) {
            // Check if the URI is encoded, decode it if necessary
            if (uriString.match(/%[0-9a-f]{2}/i)) {
                try {
                    uriString = decodeURIComponent(uriString);
                } catch (error) {
                    console.error(`Invalid encoded URI: ${uriString}`);
                    return res.status(400).send('Invalid encoded URI');
                }
            }

            try {
                uri = new URL(uriString as string);
            } catch (error) {
                console.error(`Invalid URI: ${uriString}`);
                return res.status(400).send('Invalid URI');
            }
        } else if (repoString && pathString) {
            if (repoString.match(/%[0-9a-f]{2}/i)) {
                try {
                    repoString = decodeURIComponent(repoString);
                } catch (error) {
                    console.error(`Invalid encoded repo: ${repoString}`);
                    return res.status(400).send('Invalid encoded repo');
                }
            }
            try {
                repo = new URL(repoString as string);
            } catch (error) {
                console.error(`Invalid repo: ${repoString}`);
                return res.status(400).send('Invalid repo');
            }
            if (pathString.match(/%[0-9a-f]{2}/i)) {
                try {
                    path = decodeURIComponent(pathString);
                } catch (error) {
                    console.error(`Invalid encoded path: ${pathString}`);
                    return res.status(400).send('Invalid encoded path');
                }
            } else {
                path = pathString;
            }
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Unauthorized: Signed Header missing`);
            return res.status(401).send('Unauthorized');
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFileFromRepo(email, uri!, repo!, path, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }

});

const user_org_connectors_github_folders = `user/:org/connectors/github/folders`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_folders}`, async (req: Request, res: Response) => {

    logRequest(req);
    
    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            console.error(`URI is required`);
            return res.status(400).send('URI is required');
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                console.error(`Invalid encoded URI: ${uriString}`);
                return res.status(400).send('Invalid encoded URI');
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            console.error(`Invalid URI: ${uriString}`);
            return res.status(400).send('Invalid URI');
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(401)
                .send('Unauthorized');
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFolderPathsFromRepo(email, uri, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const user_org_connectors_github_files = `user/:org/connectors/github/files`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_files}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            console.error(`URI is required`);
            return res.status(400).send('URI is required');
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                console.error(`Invalid encoded URI: ${uriString}`);
                return res.status(400).send('Invalid encoded URI');
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            console.error(`Invalid URI: ${uriString}`);
            return res.status(400).send('Invalid URI');
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(401)
                .send('Unauthorized');
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFilePathsFromRepo(email, uri, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});


const user_org_connectors_github_fullsource = `user/:org/connectors/github/fullsource`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_fullsource}`,
    express.text({ limit: '1mb' }),
    async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            console.error(`URI is required`);
            return res.status(400).send('URI is required');
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                console.error(`Invalid encoded URI: ${uriString}`);
                return res.status(400).send('Invalid encoded URI');
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            console.error(`Invalid URI: ${uriString}`);
            return res.status(400).send('Invalid URI');
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(401)
                .send('Unauthorized');
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFullSourceFromRepo(email, uri, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

async function validateProjectRepositories(email: string, org: string, resources: ProjectResource[], req: Request, res: Response) : Promise<Response | undefined> {

    // validate every resource is a valid Uri
    for (const resource of resources) {
        let resourceUri;
        try {
            resourceUri = new URL(resource.uri);
        } catch (error) {
            console.error(`Invalid URI: ${resource.uri}`);
            return res.status(400).send('Invalid URI');
        }

        // for now, we'll validate that the resource is a valid GitHub resource
        //      and we can access it with this user account plan
        // Split the hostname by '.' and check the last two parts
        const hostnameParts = resourceUri.hostname.toLowerCase().split('.');
        const topLevelDomain = hostnameParts[hostnameParts.length - 1];
        const secondLevelDomain = hostnameParts[hostnameParts.length - 2];

        // Validate that the resource is from github.com
        if (!(secondLevelDomain === 'github' && topLevelDomain === 'com')) {
            console.error(`Invalid URI: ${resource.uri}`);
            return res.status(400).send('Invalid Resource - must be Github');
        }
        // get the account status
        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(401)
                .send('Unauthorized');
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');

        // verify this account (and org pair) can access this resource
        const allowPrivateAccess = checkPrivateAccessAllowed(accountStatus);
        const repoDetails : RepoDetails = await getDetailsFromRepo(email, resourceUri, req, res, allowPrivateAccess);

        if (repoDetails.errorResponse) {
            return repoDetails.errorResponse;
        } else if (!repoDetails.data) {
            console.error(`Unable to get Repo Details and no Error found: ${resource.uri}`);
            return res.status(500).send('Internal Server Error');
        }
    }
    return undefined;
}

const user_project_org_project = `user_project/:org/:project`;
app.patch(`${api_root_endpoint}/${user_project_org_project}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        let body = req.body;

        // Puts resources and/or guidline values to be updated into new object    
        let updates: { resources?: ProjectResource[], guidelines?: string } = {};
        if (body.resources !== undefined) {
            updates.resources = body.resources;

            if (await validateProjectRepositories(email, org, body.resources, req, res)) {
                return res;
            }
        }
        if (body.guidelines !== undefined) {
            updates.guidelines = body.guidelines;
        }
    
        const projectData : UserProjectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }
        Object.assign(projectData, updates);
        const storedProjectString = JSON.stringify(projectData);

        await storeProjectData(email, SourceType.General, org, project, '', 'project', storedProjectString);
        console.log(`${user_project_org_project}: updated data`);

        const signedIdentity = (await signedAuthHeader(email))[header_X_Signed_Identity];

        // get the path of the project data uri - excluding the api root endpoint
        const projectDataPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
        try {
            await localSelfDispatch<void>(email, signedIdentity, req, `${projectDataPath}/discovery`, 'POST');
        } catch (error) {
            console.error(`Unable to launch discovery for ${projectDataPath}`, error);
        }

        return res
            .status(200)
            .send();
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const postOrPutUserProject = async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        // if req body is not a string, then we need to convert back into a normal string
        let body = req.body;

        // If body is not a string, handle accordingly
        if (typeof body !== 'string') {
            // Check if body is a Buffer
            if (Buffer.isBuffer(body)) {
                body = body.toString('utf8');
            } else if (Array.isArray(body)) {
                // Handle the case where body is an array
                // Convert array to string or handle it as needed
                body = Buffer.from(body).toString('utf8');
            } else {
                // Handle other cases (e.g., body is an object)
                body = JSON.stringify(body);
            }
        }

        if (body === '') {
            console.error(`${user_profile}: empty body`);
            return res.status(400).send('Missing body');
        }


        // Parse the body string to an object
        let updatedProject;
        try {
            updatedProject = JSON.parse(body);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(400).send('Invalid JSON');
        }

        const storedProject : UserProjectData = {
            org : org,
            name : project,
            guidelines : updatedProject.guidelines? updatedProject.guidelines : '',
            resources : updatedProject.resources? updatedProject.resources : [],
        };

        const projectPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
        try {
            const currentProjectData = await localSelfDispatch<UserProjectData>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, projectPath, 'GET');

            // check if the current data is equivalent to the existing data, and if it is, then just return success and skip validation
            if (JSON.stringify(currentProjectData) === JSON.stringify(storedProject)) {
                return res
                    .status(200)
                    .contentType('application/json')
                    .send(storedProject);
            }
        } catch (error: any) {
            // check for 404 and ignore it - everything else, log and error and then continue
            if (!error.message.includes('failed with status 404')) {
                console.error(`Unable to retrieve current project data for ${projectPath} - just post the new data - due to ${error}`);
            }
        }

        // validate this user has access to these repositories
        if (await validateProjectRepositories(email, org, storedProject.resources, req, res)) {
            return res;
        }

        const storedProjectString = JSON.stringify(storedProject);

        await storeProjectData(email, SourceType.General, org, project, '', 'project', storedProjectString);

        console.log(`${user_project_org_project}: stored data`);
        // because the discovery process may take more than 15 seconds, we never want to fail the project creation
        //      no matter how long discovery takes or even if discovery runs
        // so we'll use the axios timeout to ensure we don't wait too long for the discovery process
        const maximumDiscoveryTimeoutOnProjectCreationInSeconds = 15;

        let selfEndpoint = `${req.protocol}://${req.get('host')}${req.originalUrl}/discovery`;
        // if we're running locally, then we'll use http:// no matter what
        if (req.get('host')!.includes('localhost')) {
            selfEndpoint = `http://${req.get('host')}${req.originalUrl}/discovery`;
        }
        const authHeader = await signedAuthHeader(email);
        await axios.post(selfEndpoint, undefined, {
            headers: {
                'Content-Type': 'application/json',
                ...authHeader,
            },
            timeout: maximumDiscoveryTimeoutOnProjectCreationInSeconds * 1000 })
        .then(response => {
            // if the new task stage completes in 1 seconds, we'll wait...
            console.log(`TIMECHECK: ${org}:${project}:discovery completed in ${maximumDiscoveryTimeoutOnProjectCreationInSeconds} seconds`);
        })
            // otherwise, we'll move on
        .catch(error => {
            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                console.log(`TIMECHECK: TIMEOUT: ${org}:${project}:discovery timed out after ${maximumDiscoveryTimeoutOnProjectCreationInSeconds} seconds`);
            } else {
                // This block is for handling errors, including 404 and 500 status codes
                if (axios.isAxiosError(error) && error.response) {
                    console.log(`TIMECHECK: ${org}:${project}:discovery failed ${error.response.status}:${error.response.data} - due to error: ${error}`);
                } else {
                    // Handle other errors (e.g., network errors)
                    console.log(`TIMECHECK: ${org}:${project}:discovery failed due to error: ${error}`);
                }
            }
        });

        return res
            .status(200)
            .contentType('application/json')
            .send(storedProject);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
}

// route for both project PUT and POST
app.route(`${api_root_endpoint}/${user_project_org_project}`)
    .post(postOrPutUserProject)
    .put(postOrPutUserProject);

app.get(`${api_root_endpoint}/${user_project_org_project}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }

        // for now, we're going to report the owner of the project as the email asking
        //      in the future, we may have owners of projects set as organizations
        projectData.owner = email;

        return res
            .status(200)
            .contentType('application/json')
            .send(projectData);

    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
    
});

app.delete(`${api_root_endpoint}/${user_project_org_project}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'project');
        console.log(`${user_project_org_project}: deleted data`);

        return res
            .status(200)
            .send();
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
    
});

const searchWildcard = '*';
// Services to search the entire system for any project
const search_projects = `search/projects`;
app.get(`${api_root_endpoint}/${search_projects}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        // since project search is system wide by default, we're going to require admin access to
        //      run a search
        const email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        // query params support:
        //  - org?: string - specific org, or all if not specified
        //  - project?: string - specific project, or all if not specified
        //  - user?: string - a specific user, or all if not specified

        const { org, project, user } = req.query;
        if (org && typeof org !== 'string') {
            console.error(`Org must be a string`);
            return res.status(400).send('Invalid org');
        } else if (project && typeof project !== 'string') {
            console.error(`Project must be a string`);
            return res.status(400).send('Invalid project');
        } else if (user && typeof user !== 'string') {
            console.error(`User must be a string`);
            return res.status(400).send('Invalid user');
        }

        const projectDataList : UserProjectData[] = [];

        const projectDataRaw : any[] = await searchProjectData(user?user as string:searchWildcard, SourceType.General, org?org as string:searchWildcard, project?project as string:searchWildcard, "", 'project');

        if (!projectDataRaw) {
            console.error(`No projects found due to query failure`);
            return res
                .status(500)
                .send('Internal Server Error');
        }

        if (process.env.TRACE_LEVEL) {
            console.log(`${search_projects}: retrieved data for ${projectDataRaw.length} raw project data`);
        }

        for (const projectData of projectDataRaw) {
            const projectDataString = projectData.data as string;
            try {
                const projectDataObject = JSON.parse(projectDataString) as UserProjectData;

                // the project owner is the first part of the project data path, up until the first '/'
                projectDataObject.owner = projectData.projectPath.substring(0, projectData.projectPath.indexOf('/'));

                projectDataList.push(projectDataObject);
            } catch (error) {
                console.error(`Unable to parse project data: ${projectDataString}`, error);
            }
        }

        if (process.env.TRACE_LEVEL) {
            console.log(`${search_projects}: retrieved data for ${projectDataList.length} projects`);
        }

        return res
            .status(200)
            .contentType('application/json')
            .send(projectDataList);

    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const groom_projects = `groom/projects`;
app.post(`${api_root_endpoint}/${groom_projects}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const originalIdentityHeader = getSignedIdentityFromHeader(req);
        if (!originalIdentityHeader) {
            console.error(`Unauthorized: Signed Header missing`);
            return res.status(401).send('Unauthorized');
        }

        // get all the projects
        const projects : UserProjectData[] =
            await localSelfDispatch<UserProjectData[]>(email, originalIdentityHeader, req, `search/projects`, 'GET');

            // we'll look for projects with resources, and then make sure they are up to date
        const projectsWithResources = projects.filter(project => project.resources.length > 0);

        const projectsGroomed : UserProjectData[] = [];
        // for each project, we'll check the status of the resources
        for (const project of projectsWithResources) {
            const projectDataPath = user_project_org_project.replace(":org", project.org).replace(":project", project.name);

            if (!project.owner) {
                console.error(`Unable to groom; Project ${projectDataPath} has no owner`);
                continue;
            }

            const thisProjectIdentityHeader = (await signedAuthHeader(project.owner!))[header_X_Signed_Identity];
            // we'll fork/async the grooming process for each project (NOTE NO use of 'await' here)
            try {
                localSelfDispatch<void>(project.owner!, thisProjectIdentityHeader, req, `${projectDataPath}/groom`, 'POST');
                projectsGroomed.push(project);
            } catch (error) {
                console.error(`Unable to launch async grooming for ${projectDataPath}`, error);
            }
        }

        return res
            .status(200)
            .contentType('application/json')
            .send(projectsGroomed);

    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

// create an object with the project goals
interface ProjectGoals {
    goals?: string;
}

const user_project_org_project_discovery = `user_project/:org/:project/discovery`;
app.post(`${api_root_endpoint}/${user_project_org_project_discovery}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        // take the original request uri and remove the trailing /discovery to get the project data
        const originalUri = req.originalUrl;
        const projectDataUri = originalUri.substring(0, originalUri.lastIndexOf('/discovery'));
        // get the path of the project data uri - excluding the api root endpoint
        const projectDataPath = projectDataUri.substring(projectDataUri.indexOf("user_project"));

        // kickoff project processing now, by creating the project resources, then initiating the first
        //      data store upload
        const resourcesToGenerate : ProjectDataType[] = [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification];
        const durationInEachStep : number[] = [ Math.floor(Date.now() / 1000) ];
        console.log(`Starting Discovery for ${projectDataPath}`);
        for (const resource of resourcesToGenerate) {
            const startProcessing = {"status": "processing"};

            const signedIdentity = (await signedAuthHeader(email))[header_X_Signed_Identity];

            const generatorPath = `${projectDataPath}/data/${resource}/generator`;
            try {
                const newGeneratorState = await localSelfDispatch<void>(
                    email,
                    signedIdentity, 
                    req,
                    generatorPath,
                    'PUT',
                    startProcessing);
                console.log(`New Generator State: ${JSON.stringify(newGeneratorState)}`);
            } catch (error) {
                console.error(`Discovery unable to launch generator (continuing) for ${generatorPath}`, error);
            }
            durationInEachStep.push(Math.floor(Date.now() / 1000));
            console.log(`Discovery Step ${resource.toString()} took: ${durationInEachStep[durationInEachStep.length - 1] - durationInEachStep[durationInEachStep.length - 2]} seconds`);
        }

        const signedIdentity = (await signedAuthHeader(email))[header_X_Signed_Identity];
        const existingDataReferences = await localSelfDispatch<ProjectDataReference[]>(email, signedIdentity, req, `${projectDataPath}/data_references`, 'PUT');
        durationInEachStep.push(Math.floor(Date.now() / 1000));
        console.log(`Existing Data References: ${JSON.stringify(existingDataReferences)}`);

        // print the time in last step
        console.log(`Discovery Step Data References took: ${durationInEachStep[durationInEachStep.length - 1] - durationInEachStep[durationInEachStep.length - 2]} seconds`);

        return res
            .status(200)
            .send(existingDataReferences);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }    
});

enum ProjectStatus {
    Unknown = 'Unknown',                                    // project not found
    ResourcesMissing = 'Resources Missing',                 // project uris found, but not resources
    // ResourcesOutOfDate = 'Resources Out of Date',        // Resources out of date with source (e.g. newer source)
    ResourcesIncomplete = 'Resources Incomplete',           // resources found, but not completely generated
    ResourcesInError = 'Resources In Error',                // resources found, but generators in error state
    ResourcesGenerating = 'Resources Generating',           // resources missing or incomplete, but still being generated
    ResourcesNotSynchronized = 'Resources Not Synchronized',// resources completely generated, but not synchronized to OpenAI
    AIResourcesOutOfDate = 'AI Data Out of Date',           // resources synchronized to OpenAI, but newer resources available
    Synchronized = 'Fully Synchronized'                     // All current resources completely synchronized to OpenAI
}

interface ProjectStatusState {
    status: ProjectStatus;
    synchronized?: boolean;
    last_synchronized?: number;
    activelyUpdating?: boolean;
    details?: string;
    last_updated: number;
}

const MinutesToWaitBeforeGeneratorConsideredStalled = 3;

const user_project_org_project_status = `user_project/:org/:project/status`;

app.patch(`${api_root_endpoint}/${user_project_org_project_status}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        let body = req.body;
        if (!body) {
            console.error(`No body found`);
            return res.status(400).send('Invalid body');
        }
        if (typeof body !== 'string') {
            // Check if body is a Buffer
            if (Buffer.isBuffer(body)) {
                body = body.toString('utf8');
            } else if (Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            } else {
                body = JSON.stringify(body);
            }
        }

        if (body === '') {
            console.error(`${req.originalUrl}: empty body`);
            return res.status(400).send('Missing body');
        }

        // Parse the body string to an object
        let updatedStatus;
        try {
            updatedStatus = JSON.parse(body);
            if (updatedStatus.status !== ProjectStatus.Unknown) {
                return res
                    .status(400)
                    .send('Invalid status - only Unknown status can be set');
            }
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(400).send('Invalid JSON');
        }

        const { org, project } = req.params;

        const rawProjectStatusData = await getProjectData(email, SourceType.General, org, project, '', 'status');

        let projectStatus : ProjectStatusState | undefined = undefined;
        if (rawProjectStatusData) {
            projectStatus = JSON.parse(rawProjectStatusData) as ProjectStatusState;
            projectStatus.status = updatedStatus.status;

            await storeProjectData(email, SourceType.General, org, project, '', 'status', JSON.stringify(projectStatus));
            console.log(`${user_project_org_project_status}: updated status`);

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        } else {
            return res
                .status(404)
                .send('Project Status not found');
        }
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.get(`${api_root_endpoint}/${user_project_org_project_status}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        const rawProjectStatusData = await getProjectData(email, SourceType.General, org, project, '', 'status');

        let projectStatus : ProjectStatusState | undefined = undefined;
        if (rawProjectStatusData) {
            projectStatus = JSON.parse(rawProjectStatusData) as ProjectStatusState;
        }

        // if there's no project status yet - let's try and build one
        if (!projectStatus) {
            // if we have no status, let's see if there's a real project here...
            const projectData = await loadProjectData(email, org, project) as UserProjectData;
            // if no project, then just 404 so user knows not to ask again
            if (!projectData) {
                return res.status(404).send('Project not found');
            }
            // if we have a real project, and we have no status, then let's try and generate it now
            console.error(`Project Status not found; Project exists so let's refresh status`);

            // project uri starts at 'user_project/'
            const project_subpath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
            // this will be a blocking call (when GET is normally very fast), but only to ensure we have an initial status
            projectStatus = await localSelfDispatch<ProjectStatusState>(email, getSignedIdentityFromHeader(req)!, req, project_subpath, 'POST');

        // if we have already cached project status, but its marked Unknown - then try and refresh it
        } else if (projectStatus.status === ProjectStatus.Unknown) {
            // project uri starts at 'user_project/'
            const project_subpath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
            // this will be a blocking call (when GET is normally very fast), but only to ensure we have an initial status
            projectStatus = await localSelfDispatch<ProjectStatusState>(email, getSignedIdentityFromHeader(req)!, req, project_subpath, 'POST');
        }

        console.log(`Project Status: ${JSON.stringify(projectStatus)}`);

        return res
            .status(200)
            .contentType('application/json')
            .send(projectStatus);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.post(`${api_root_endpoint}/${user_project_org_project_status}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        const projectStatus : ProjectStatusState = {
            status: ProjectStatus.Unknown,
            last_synchronized: undefined,
            synchronized: false,
            activelyUpdating: false,
            last_updated : Math.floor(Date.now() / 1000) // default something and refresh when saved
        };

        // get the resource uri for this project
        const requestUri = req.originalUrl;
        const fullProjectDataUri = requestUri.substring(0, requestUri.lastIndexOf('/status'));
        // get the relative uri from the api base
        const projectDataUri = fullProjectDataUri.substring(fullProjectDataUri.indexOf("user_project"));

        // first we're going to see if the files have been synchronized to AI store ever
        let dataReferences : ProjectDataReference[] = [];
        try {
            dataReferences = await localSelfDispatch<ProjectDataReference[]>(email, getSignedIdentityFromHeader(req)!, req, `${projectDataUri}/data_references`, 'GET');
        } catch (error) {
            // if we get an error, then we'll assume the project doesn't exist
            console.error(`Project Data References not found; Project may not exist or hasn't been discovered yet`);

            // we can continue on, since we're just missing the last synchronized time - which probably didn't happen anyway
        }

        for (const dataReference of dataReferences) {
            if (dataReference.last_updated) {
                // pick the newest last_updated date - so we report the last updated date of the most recent resource sync
                if (!projectStatus.last_synchronized || projectStatus.last_synchronized < dataReference.last_updated) {
                    projectStatus.last_synchronized = dataReference.last_updated;
                }
                break;
            }
        }

        // get the project data
        let projectData : UserProjectData;
        try {
            projectData = await localSelfDispatch<UserProjectData>(email, getSignedIdentityFromHeader(req)!, req, projectDataUri, 'GET');
        } catch (error: any) {
            if (error.response && error.response.status === 404) {
                console.error(`Project not found: ${projectDataUri}`);
                return res.status(404).send('Project not found');
            } else if (error.response && error.response.status === 401) {
                console.error(`Unauthorized: ${projectDataUri}`);
                return res.status(401).send('Unauthorized');
            }

            console.error(`Unable to get project data: ${projectDataUri}`, error);
            return res.status(500).send('Internal Server Error');
        }

        const saveProjectStatusUpdate = async () => {
            // save the project status
            try {
                // set current timestamp
                projectStatus.last_updated = Math.floor(Date.now() / 1000);

                await storeProjectData(email, SourceType.General, org, project, '', 'status', JSON.stringify(projectStatus));
                console.log(`${user_project_org_project_status}: persisted status`);
            } catch (error) {
                console.error(`Unable to persist project status`, error);
            }
        }

        // if we have no resources, then we're done - report it as synchronized - since we have no data :)
        if (projectData.resources.length === 0) {
            projectStatus.status = ProjectStatus.Synchronized;
            projectStatus.details = `No GitHub resources found - nothing to synchronize`;
            console.log(`Project Status OK: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        }

        const missingResources : string[] = [];
        for (const resource of [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification]) {
            // check if this resource exists, and get its timestamp
            let resourceStatus : ResourceStatusState;
            try {
                resourceStatus = await localSelfDispatch<ResourceStatusState>(email, getSignedIdentityFromHeader(req)!, req, `${projectDataUri}/data/${resource}/status`, 'GET');
                console.debug(`Resource ${resource} Status: ${JSON.stringify(resourceStatus)}`);
            } catch (error) {
                missingResources.push(resource);
            }
        }

        let lastResourceCompletedGenerationTime: number | undefined = undefined;
        let lastResourceGeneratingTime: number | undefined = undefined;
        const incompleteResources : string[] = [];
        const currentResourceStatus : TaskStatus[] = [];
        for (const resource of [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification]) {
            let generatorStatus : GeneratorState;
            try {
                generatorStatus = await localSelfDispatch<GeneratorState>(email, getSignedIdentityFromHeader(req)!, req, `${projectDataUri}/data/${resource}/generator`, 'GET');                console.debug
            } catch (error) {
                // if generator fails, we'll assume the resource isn't available either
                missingResources.push(resource);
                currentResourceStatus.push(TaskStatus.Error);

                continue;
            }
            if (generatorStatus.stage !== Stages.Complete) {
                currentResourceStatus.push(generatorStatus.status);

                // we nede to determine if the generator is still processing, and if so, what the last updated time
                if (generatorStatus.status === TaskStatus.Processing) {
                    if (!lastResourceGeneratingTime) {
                        lastResourceGeneratingTime =  generatorStatus.last_updated;
                    } else if (!generatorStatus.last_updated) {
                        console.log(`Can't get last generated time for: ${resource}`);
                    } else if (lastResourceGeneratingTime < generatorStatus.last_updated) {
                        lastResourceGeneratingTime = generatorStatus.last_updated;
                    }
                }

                // if the generator is not completed, then we're not using the best resource data
                //      so even if we've synchronized, its only partial resource data (e.g. partial source, or incomplete blueprint)
                incompleteResources.push(resource);
                continue;
            }
            // if we've gotten here, then the generator is complete, so we'll use the last completed time
            if (!lastResourceCompletedGenerationTime || !generatorStatus.last_updated ||
                 lastResourceCompletedGenerationTime < generatorStatus.last_updated) {
                    // store the latest completion time
                lastResourceCompletedGenerationTime = generatorStatus.last_updated;
            }
        }
        // check if we're actively processing
        if (lastResourceGeneratingTime) {
            // if the active processing is greater than 2 minutes, then we'll assume we're not actively processing (and we've stalled)
            if (lastResourceGeneratingTime < (Math.floor(Date.now() / 1000) - (60 * MinutesToWaitBeforeGeneratorConsideredStalled))) {
                projectStatus.activelyUpdating = false;
            } else {
                projectStatus.activelyUpdating = true;
            }
        }
        // if we have missing or incomplete resources, but they are still being generated, then we're still generating
        if (projectStatus?.activelyUpdating) {
            projectStatus.status = ProjectStatus.ResourcesGenerating;
            missingResources.push(...incompleteResources);
            projectStatus.details = `Generating Resources: ${missingResources.join(', ')}`;
            console.warn(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        }
        const inErrorState : boolean = currentResourceStatus.filter(status => status === TaskStatus.Error).length > 0;
        if (inErrorState) {
            projectStatus.status = ProjectStatus.ResourcesInError;
            const errorResources = missingResources.concat(incompleteResources);
            projectStatus.details = `Resources in Error: ${errorResources.join(', ')}`;
            console.error(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        }
        // otherwise, if we have missing resources, we're stalled
        if (missingResources.length > 0) {
            projectStatus.status = ProjectStatus.ResourcesMissing;
            projectStatus.details = `Missing Resources: ${missingResources.join(', ')}`;
            console.error(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        }
        // or if we have incomplete resources, we're stalled
        if (incompleteResources.length > 0) {
            projectStatus.status = ProjectStatus.ResourcesIncomplete;
            projectStatus.details = `Incomplete Resources: ${incompleteResources.join(', ')}`;
            console.error(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        }

        // if all resources were completed, but we didn't get an updated time, then we're in uncharted territory- bail
        if (!lastResourceCompletedGenerationTime) {
            projectStatus.status = ProjectStatus.ResourcesIncomplete;
            projectStatus.details = `Resources Completed Generation, but no Timestamp`;

            console.error(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        }

        // now that our resources have completed generation, we want to make sure the data_references timestamp is AFTER the generators completed
        //      otherwise, we'll report that the resources are not synchronized
        if (!projectStatus.last_synchronized) {
            // if we've never synchronized the data, then report not synchronized
            projectStatus.status = ProjectStatus.ResourcesNotSynchronized;
            console.error(`Project Status: Resources Completed Generation but not Uploaded to AI Servers`);

            await saveProjectStatusUpdate();

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        }

        // now we have completed resources and previously synchronized data, so now we'll check if the resource data is newer than the
        //      last synchronized time for the AI server upload
        if (projectStatus.last_synchronized < lastResourceCompletedGenerationTime) {
            // if the last resource completed generation time is newer than the last synchronized time, then we're out of date
            projectStatus.status = ProjectStatus.AIResourcesOutOfDate;
            projectStatus.details = `Resources Completed Generation, but not Uploaded to AI Servers`;

            console.error(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(200)
                .contentType('application/json')
                .send(projectStatus);
        }

        // we're all good - all data is up to date, resources completely generated and fully synchronized to AI Servers
        projectStatus.status = ProjectStatus.Synchronized;
        projectStatus.synchronized = true;
        projectStatus.details = `All Resources Completely Generated and Uploaded to AI Servers`;

        console.log(`Project Status OK: ${JSON.stringify(projectStatus)}`);

        await saveProjectStatusUpdate();

        return res
            .status(200)
            .send(projectStatus);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }    
});

enum GroomingStatus {
    Completed = 'Completed',
    Grooming = 'Grooming',
    Skipping = 'Skipping',
    Error = 'Error'
}

interface ProjectGroomState {
    status: GroomingStatus;
    last_updated: number;
}

const user_project_org_project_groom = `user_project/:org/:project/groom`;
app.post(`${api_root_endpoint}/${user_project_org_project_groom}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const projectGroomPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
        const projectPath = projectGroomPath.substring(0, projectGroomPath.lastIndexOf('/groom'));

        // we'll check the status of the project data
        let projectStatus : ProjectStatusState;
        try {
            projectStatus = await localSelfDispatch<ProjectStatusState>(email, getSignedIdentityFromHeader(req)!, req, `${projectPath}/status`, 'GET');
        } catch (error: any) {
            if (error.response && error.response.status === 404) {
                console.error(`Project Status not found; Project may not exist or hasn't been discovered yet`);
                return res.status(404).send('Project not found');
            }
            console.error(`Unable to query Project Status`, error);
            return res.status(500).send('Internal Server Error');
        }

        // if the project is actively updating/discovery, then groomer will be idle
        if (projectStatus.activelyUpdating) {
            const groomingState = {
                status: GroomingStatus.Skipping,
                last_updated: Math.floor(Date.now() / 1000)
            };
            return res
                .status(200)
                .contentType('application/json')
                .send(groomingState);
        }
        // if we're not synchronized, and idle, then try again
        if (projectStatus.status !== ProjectStatus.Synchronized) {
            try {
                console.log(`Launching Groomed Discovery for ${projectPath} with status ${JSON.stringify(projectStatus)}`);

                const originalIdentityHeader = getSignedIdentityFromHeader(req);
                await localSelfDispatch<void>(email, originalIdentityHeader!, req, `${projectPath}/discovery`, 'POST');

                const groomingState = {
                    status: GroomingStatus.Grooming,
                    last_updated: Math.floor(Date.now() / 1000)
                };
                return res
                    .status(200)
                    .contentType('application/json')
                    .send(groomingState);
            } catch (error) {
                console.error(`Groomer unable to launch discovery for ${projectPath}`, error);
                const groomingState = {
                    status: GroomingStatus.Error,
                    last_updated: Math.floor(Date.now() / 1000)
                };
                return res
                    .status(200)
                    .contentType('application/json')
                    .send(groomingState);
            }
        }

        const groomingState = {
            status: GroomingStatus.Completed,
            last_updated: Math.floor(Date.now() / 1000)
        };
        return res
            .status(200)
            .contentType('application/json')
            .send(groomingState);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }    
});

const user_project_org_project_goals = `user_project/:org/:project/goals`;
app.delete(`${api_root_endpoint}/${user_project_org_project_goals}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'goals');
        console.log(`${user_project_org_project_goals}: deleted data`);

        return res
            .status(200)
            .send();
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }    
});

app.post(`${api_root_endpoint}/${user_project_org_project_goals}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        // if req body is not a string, then we need to convert back into a normal string
        let body = req.body;
        if (typeof body !== 'string') {
            // Check if body is a Buffer
            if (Buffer.isBuffer(body)) {
                body = body.toString('utf8');
            } else if (Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            } else {
                body = JSON.stringify(body);
            }
        }

        if (body === '') {
            console.error(`${user_profile}: empty body`);
            return res.status(400).send('Missing body');
        }

        // Parse the body string to an object
        let updatedGoals;
        try {
            updatedGoals = JSON.parse(body);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(400).send('Invalid JSON');
        }

        await storeProjectData(email, SourceType.General, org, project, '', 'goals', JSON.stringify(updatedGoals));

        console.log(`${user_project_org_project_goals}: stored data`);

        return res
            .status(200)
            .contentType('application/json')
            .send(updatedGoals);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
    
});

app.get(`${api_root_endpoint}/${user_project_org_project_goals}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        const projectGoalsRaw = await getProjectData(email, SourceType.General, org, project, '', 'goals');

        let projectGoals : ProjectGoals = {};
        if (projectGoalsRaw) {
            projectGoals = JSON.parse(projectGoalsRaw);
        }

        return res
            .status(200)
            .contentType('application/json')
            .send(projectGoals);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }

});

const user_project_org_project_config_boostignore = `user_project/:org/:project/config/.boostignore`;
app.get(`${api_root_endpoint}/${user_project_org_project_config_boostignore}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        // Combine all arrays and create a Set to remove duplicates
        const combinedIgnorePatterns = new Set([
            ...defaultBoostIgnorePaths,
            ...boostFilterFiles,
            ...potentiallyUsefulTextFiles,
            ...defaultIgnoredFolders,
            ...binaryFilePatterns,
            ...textFilePatterns
        ]);

        const ignoreFileSpecs : string[] = Array.from(combinedIgnorePatterns);

        console.log(`${user_project_org_project_config_boostignore}: read-only .boostignore returned`);

        return res
            .status(200)
            .contentType('application/json')
            .send(ignoreFileSpecs);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const user_project_org_project_data_resource = `user_project/:org/:project/data/:resource`;
app.get(`${api_root_endpoint}/${user_project_org_project_data_resource}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }

        const uri = new URL(projectData.resources[0].uri);

        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const { _, __, resource } = req.params;
        const resourceData = await getCachedProjectData(email, SourceType.GitHub, ownerName, repoName, '', resource);
        if (!resourceData) {
            console.error(`${user_project_org_project_data_resource}: not found: ${ownerName}/${repoName}/data/${resource}`);
            return res.status(404).send('Resource not found');
        }

        return res
            .status(200)
            .contentType('application/json')
            .send(resourceData);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

interface ResourceStatusState {
    last_updated: number;
}

const user_project_org_project_data_resource_status = `user_project/:org/:project/data/:resource/status`;
app.get(`${api_root_endpoint}/${user_project_org_project_data_resource_status}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }

        const uri = new URL(projectData.resources[0].uri);

        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const { _, __, resource } = req.params;
        let resourceStatusRaw = await getCachedProjectData(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status");
        if (!resourceStatusRaw) {
            // if the resource status was not found, check if the resource exists... we may just be missing the status
            // so we'll regenerate the status
            const resourceData = await getCachedProjectData(email, SourceType.GitHub, ownerName, repoName, '', resource);
            // resource doesn't exist, so just report missing/Not Found
            if (!resourceData) {
                console.error(`${user_project_org_project_data_resource_status}: not found: ${ownerName}/${repoName}/data/${resource}`);
                return res.status(404).send('Resource not found');
            }
            // resource exists, so we'll generate the status
            const resourceStatusWithTimestamp : ResourceStatusState = {
                last_updated: Math.floor(Date.now() / 1000)
            };
            resourceStatusRaw = JSON.stringify(resourceStatusWithTimestamp);
            await storeProjectData(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status", resourceStatusRaw);
            console.warn(`Missing status for resource ${req.originalUrl}: generating with current timestamp`);
        }

        const resourceStatus : ResourceStatusState = JSON.parse(resourceStatusRaw);

        return res
            .status(200)
            .contentType('application/json')
            .send(resourceStatus);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_project_org_project_data_resource}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }

        const uri = new URL(projectData.resources[0].uri);

        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const { _, __, resource } = req.params;
        
        await deleteProjectData(email, SourceType.GitHub, ownerName, repoName, '', resource);

        console.log(`${user_project_org_project_data_resource}: deleted data`);

        return res
            .status(200)
            .send();
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

// Middleware for parsing plain text with a limit of 1mb
const textParserWithMbLimit = bodyParser.text({ limit: '1mb' });

app.route(`${api_root_endpoint}/${user_project_org_project_data_resource}`)
   .post(textParserWithMbLimit, postOrPutUserProjectDataResource)
   .put(textParserWithMbLimit, postOrPutUserProjectDataResource);

const user_project_org_project_data_resource_generator = `user_project/:org/:project/data/:resource/generator`;
app.delete(`${api_root_endpoint}/${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }

        const uri = new URL(projectData.resources[0].uri);
        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const { _, __, resource } = req.params;

        await deleteProjectData(email, SourceType.GitHub, ownerName, repoName, '', `${resource}/generator`);

        console.log(`${user_project_org_project_data_resource_generator}: deleted data`);

        return res
            .status(200)
            .send();
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.get(`${api_root_endpoint}/${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }

        const uri = new URL(projectData.resources[0].uri);
        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const { _, __, resource } = req.params;
        const currentInput = await getProjectData(email, SourceType.GitHub, ownerName, repoName, '', `${resource}/generator`);
        if (!currentInput) {
            console.log(`${user_project_org_project_data_resource_generator}: simulated idle data`);

            return res
                .status(200)
                .contentType('application/json')
                .send({
                    status: TaskStatus.Idle,
                } as GeneratorState);
        } else {

            const generatorData = JSON.parse(currentInput) as GeneratorState;

            return res
                .status(200)
                .contentType('application/json')
                .send(generatorData);
        }
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

// for updating the generator task status
app.patch(`${api_root_endpoint}/${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return res;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }

            return res.status(400).send('Invalid resource path');
        }

        const loadedProjectData = await loadProjectData(email, org, project) as UserProjectData | Response;
        if (!loadedProjectData) {
            return res.status(404).send('Project not found');
        }
        const projectData = loadedProjectData as UserProjectData;

        const uri = new URL(projectData.resources[0].uri);
        const pathSegments = uri.pathname.split('/').filter(segment => segment);
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const { _, __, resource } = req.params;
        let currentGeneratorState : GeneratorState =
            await getProjectData(email, SourceType.GitHub, ownerName, repoName, '', `${resource}/generator`);
        if (!currentGeneratorState) {
            currentGeneratorState = {
                status: TaskStatus.Idle,
            };
        } else if (typeof currentGeneratorState === 'string') {
            currentGeneratorState = JSON.parse(currentGeneratorState) as GeneratorState;
        }

        let body = req.body;
        if (typeof body !== 'string') {
            if (Buffer.isBuffer(body) || Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            } else {
                body = JSON.stringify(body);
            }
        }
        if (body === '') {
            console.error(`PATCH ${user_project_org_project_data_resource_generator}: empty body`);
            return res.status(400).send('Missing body');
        }

        let input : GeneratorState;
        try {
            input = JSON.parse(body);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(400).send('Invalid JSON Body');
        }
        if (input.status !== currentGeneratorState.status) {
            console.error(`Invalid PATCH status: ${input.status}`);
            return res.status(400).send(`Invalid PATCH status: ${input.status}`)
        }
        if (input.last_updated) {
            currentGeneratorState.last_updated = input.last_updated;
        }
        if (input.status_details) {
            currentGeneratorState.status_details = input.status_details;
        }
        if (input.stage) {
            currentGeneratorState.stage = input.stage;
        }

        const updateGeneratorState = async (generatorState: GeneratorState) => {
            if (!generatorState.last_updated) {
                generatorState.last_updated = Math.floor(Date.now() / 1000);
            }

            await storeProjectData(email, SourceType.GitHub, ownerName, repoName, '', 
                `${resource}/generator`, JSON.stringify(generatorState));

            console.log(`${user_project_org_project_data_resource_generator}: stored new state: ${JSON.stringify(generatorState)}`);
        };

        // if we're only updating the timestamp on the processing, then don't kick off any new work
        if (currentGeneratorState.status === TaskStatus.Processing) {

            console.log(`${user_project_org_project_data_resource_generator}: updated processing task: ${JSON.stringify(currentGeneratorState)}`);
            await updateGeneratorState(currentGeneratorState);

            return res
                .status(200)
                .contentType('application/json')
                .send(currentGeneratorState);
        } else {
            // patch is only supported for processing tasks
            console.error(`Invalid PATCH status: ${currentGeneratorState.status}`);
            return res.status(400).send(`Invalid PATCH status: ${currentGeneratorState.status}`)
        }
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const putOrPostuserProjectDataResourceGenerator = async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return res;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }

            return res.status(400).send('Invalid resource path');
        }

        const loadedProjectData = await loadProjectData(email, org, project) as UserProjectData | Response;
        if (!loadedProjectData) {
            return res.status(404).send('Project not found');
        }
        const projectData = loadedProjectData as UserProjectData;

        // if we have no resources to generate data from, then we're done
        if (!projectData.resources?.length) {
            return res
                .status(200)
                .contentType('application/json')
                .send({
                    status: TaskStatus.Idle,
                    stage: Stages.Complete,
                    last_updated: Math.floor(Date.now() / 1000),
                    status_details: `No resources to generate data from`,
                } as GeneratorState);
        }

        const uri = new URL(projectData.resources[0].uri);
        const pathSegments = uri.pathname.split('/').filter(segment => segment);
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const { _, __, resource } = req.params;
        let currentGeneratorState : GeneratorState =
            await getProjectData(email, SourceType.GitHub, ownerName, repoName, '', `${resource}/generator`);
        if (!currentGeneratorState) {
            currentGeneratorState = {
                status: TaskStatus.Idle,
            };
        } else if (typeof currentGeneratorState === 'string') {
            currentGeneratorState = JSON.parse(currentGeneratorState) as GeneratorState;
        }

        let body = req.body;
        if (typeof body !== 'string') {
            if (Buffer.isBuffer(body) || Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            } else {
                body = JSON.stringify(body);
            }
        }
        if (body === '') {
            console.error(`PUT ${user_project_org_project_data_resource_generator}: empty body`);
            return res.status(400).send('Missing body');
        }

        let input : GeneratorState;
        try {
            input = JSON.parse(body);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(400).send('Invalid JSON Body');
        }
        let userGeneratorRequest : GeneratorState = {
            status: input.status
        };

        const updateGeneratorState = async (generatorState: GeneratorState) => {
            if (!generatorState.last_updated) {
                generatorState.last_updated = Math.floor(Date.now() / 1000);
            }

            await storeProjectData(email, SourceType.GitHub, ownerName, repoName, '', 
                `${resource}/generator`, JSON.stringify(generatorState));
                console.log(`${user_project_org_project_data_resource_generator}: stored new state: ${JSON.stringify(generatorState)}`);

            const projectStatusRefreshDelayInMs = 250;

            // force a refresh of the project status
            const projectStatusRefreshRequest : ProjectStatusState = {
                status: ProjectStatus.Unknown,
                last_updated: generatorState.last_updated
            };
            // we're going to start an async project status refresh (but only wait 250 ms to ensure it starts)
            await localSelfDispatch<ProjectStatusState>(
                email, getSignedIdentityFromHeader(req)!, req,
                `user_project/${org}/${project}/status`, 'PATCH', projectStatusRefreshRequest, projectStatusRefreshDelayInMs, false);

            // if we have completed all stages or reached a terminal point (e.g. error or non-active updating)
            //      then we'll upload what we have to the AI servers
            // this is all an async process (we don't wait for it to complete)
            try {
                await localSelfDispatch<ProjectDataReference[]>(email, getSignedIdentityFromHeader(req)!, req,
                    `user_project/${org}/${project}/data_references`, 'PUT', undefined, projectStatusRefreshDelayInMs, false);
            } catch (error) {
                console.error(`Error uploading data references to AI Servers:`, error);
            }
        };

        try {
            if (userGeneratorRequest.status === TaskStatus.Processing) {

                console.log(`${user_project_org_project_data_resource_generator}: processing task: ${JSON.stringify(userGeneratorRequest)}`);

                try {
                    currentGeneratorState.status = TaskStatus.Processing;
                    currentGeneratorState.last_updated = undefined; // get a refreshed last updated timestamp 
                    await updateGeneratorState(currentGeneratorState);

                    // Launch the processing task
                    let selfEndpoint = `${req.protocol}://${req.get('host')}`;
                    // if we're running locally, then we'll use http:// no matter what
                    if (req.get('host')!.includes('localhost')) {
                        selfEndpoint = `http://${req.get('host')}`;
                    }

                    const processNextStageState : ResourceGeneratorProcessState = {
                        stage: currentGeneratorState.stage!,
                    };
                    if (typeof processNextStageState.stage !== 'string') {
                        processNextStageState.stage = "";
                    }
                    const pathToProcess = `${req.originalUrl.substring(req.originalUrl.indexOf('user_project'))}/process`;

                    const processStartTime = Math.floor(Date.now() / 1000);
                    console.log(`TIMECHECK: ${processNextStageState.stage?processNextStageState.stage:"[Initializing]"}: processing started at ${processStartTime}`);

                    const newGeneratorState = await localSelfDispatch<ResourceGeneratorProcessState>(email, getSignedIdentityFromHeader(req)!, req, pathToProcess, "POST", processNextStageState.stage?processNextStageState:undefined);
                    if (!newGeneratorState?.stage) {
                        throw new Error(`Missing stage returned: ${pathToProcess}`);
                    }
                    currentGeneratorState.stage = newGeneratorState.stage;

                    const processEndTime = Math.floor(Date.now() / 1000);
                    console.log(`TIMECHECK: ${processNextStageState.stage?processNextStageState.stage:"[Initializing]"}: processing ended at ${processEndTime} (${processEndTime - processStartTime} seconds) - move to stage:${currentGeneratorState.stage}`);

                    // if we've finished all stages, then we'll set the status to complete and idle
                    if (currentGeneratorState.stage === Stages.Complete) {
                        console.log(`${user_project_org_project_data_resource_generator}: completed all stages`);

                        currentGeneratorState.status = TaskStatus.Idle;
                    }

                    await updateGeneratorState(currentGeneratorState);
                } catch (error) {
                    console.error(`Error processing stage ${currentGeneratorState.stage}:`, error);

                    if (error instanceof GeneratorProcessingError) {
                        const processingError = error as GeneratorProcessingError;
                        if (processingError.stage != currentGeneratorState.stage) {
                            console.error(`${req.originalUrl}: Resetting to ${processingError.stage} due to error in ${resource} stage ${currentGeneratorState.stage}:`, processingError);
                        }
                    }

                    // In case of error, set status to error
                    currentGeneratorState.status = TaskStatus.Error;
                    currentGeneratorState.last_updated = undefined; // get a refreshed last updated timestamp

                    await updateGeneratorState(currentGeneratorState);

                    // we errored out, so we'll return an error HTTP status code for operation failed, may need to retry
                    return res.status(500).send();
                }

                // if we're processing and not yet completed the full stages, then we need to process the next stage
                if (currentGeneratorState.status === TaskStatus.Processing && currentGeneratorState.stage !== Stages.Complete) {
                    // we need to terminate the current call so we don't create a long blocking HTTP call
                    //      so we'll start a new async HTTP request - detached from the caller to continue processing
                    //      the next stage
                    console.log(`${user_project_org_project_data_resource_generator}: starting async processing for ${JSON.stringify(currentGeneratorState)}`);

                    // create a new request object
                    const newProcessingRequest : GeneratorState = {
                        status: TaskStatus.Processing,
                    };

                    // start async HTTP request against this serverless app
                    // we're going to make an external call... so the lifetime of the forked call is not tied to the
                    //      lifetime of the current call. Additionally, we need to wait a couple seconds to make sure
                    //      the new call is created before we return a response to the caller and the host of this call
                    //      terminates

                    let selfEndpoint = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
                    // if we're running locally, then we'll use http:// no matter what
                    if (req.get('host')!.includes('localhost')) {
                        selfEndpoint = `http://${req.get('host')}${req.originalUrl}`;
                    }

                    const authHeader = await signedAuthHeader(email);
                    console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} starting async processing`);
                    // we're going to wait for completion or 1 second to pass
                    await axios.put(selfEndpoint, newProcessingRequest, {
                            headers: {
                                'Content-Type': 'application/json',
                                ...authHeader,
                            },
                            timeout: 1000 })
                        .then(response => {
                            // if the new task stage completes in 1 seconds, we'll wait...
                            console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} completed async processing`);
                        })
                            // otherwise, we'll move on
                        .catch(error => {
                            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                                console.log(`TIMECHECK: TIMEOUT: ${org}:${project}:${resource}:${currentGeneratorState.stage} async processing timed out after 1 seconds`);
                            } else {
                                // This block is for handling errors, including 404 and 500 status codes
                                if (axios.isAxiosError(error) && error.response) {
                                    console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} async processing failed due to error: ${error.response.status}:${error.response.statusText} due to error:${error}`);
                                } else {
                                    // Handle other errors (e.g., network errors)
                                    console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} failed async processing ${error}`);
                                }
                            }
                        });
                    console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} After async processing`);
                                    
                    // Return a response immediately without waiting for the async process
                    return res
                        .status(202)
                        .contentType('application/json')
                        .send(currentGeneratorState);
                }
            } else if (userGeneratorRequest.status === TaskStatus.Idle) {
                console.log(`${user_project_org_project_data_resource_generator}: idle task: ${JSON.stringify(userGeneratorRequest)}`);

                if (currentGeneratorState.status === TaskStatus.Processing) {
                    // if we have been processing for less than 3 minutes, then we'll return busy HTTP status code
                    //      We choose 3 minutes because the forked rate above waits 2 seconds before returning
                    //      so if a new task runs, we'd expect to update processing time at least every 1-2 minutes
                    if (currentGeneratorState.last_updated &&
                        currentGeneratorState.last_updated > (Math.floor(Date.now() / 1000) - 60 * MinutesToWaitBeforeGeneratorConsideredStalled)) {
                        // if caller wants us to be idle, and we're busy processing, we'll return busy HTTP
                        //      status code
                        return res
                            .status(409)
                            .contentType('application/json')
                            .send(currentGeneratorState);
                    } else {
                        // if we have been processing for more than 15 minutes, then we'll return idle HTTP status code
                        //      and we'll reset the status to idle
                        currentGeneratorState.status = TaskStatus.Idle;
                        await updateGeneratorState(currentGeneratorState);
                    }
                }
            } else if (userGeneratorRequest.status === TaskStatus.Error) {
                // external caller can't set the status to error, so we'll return bad input HTTP status code
                console.error(`Invalid input status: ${userGeneratorRequest.status}`);
                return res.status(400).send();
            } else {
                // external caller can't set the status to unknown, so we'll return bad input HTTP status code
                console.error(`Invalid input status: ${userGeneratorRequest.status}`);
                return res.status(400).send();
            }
        } catch (error) {
            console.error(`Handler Error: ${user_project_org_project_data_resource_generator}: Unable to handle task request:`, error);
            return res.status(500).send('Internal Server Error');
        }

        return res
            .status(200)
            .contentType('application/json')
            .send(currentGeneratorState);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
};

app.route(`${api_root_endpoint}/${user_project_org_project_data_resource_generator}`)
   .post(putOrPostuserProjectDataResourceGenerator)
   .put(putOrPostuserProjectDataResourceGenerator);

async function processStage(serviceEndpoint: string, email: string, project: UserProjectData, resource: string, stage?: string) {
    
    if (stage) {
        console.log(`Processing ${resource} stage ${stage}...`);
    }
    let thisGenerator : Generator;
    switch (resource) {
        case ProjectDataType.ProjectSource:
            thisGenerator = new ProjectSourceGenerator(serviceEndpoint, email, project);
            break;
        case ProjectDataType.ProjectSpecification:
            thisGenerator = new ArchitecturalSpecificationGenerator(serviceEndpoint, email, project);
            break;
        case ProjectDataType.ArchitecturalBlueprint:
            thisGenerator = new BlueprintGenerator(serviceEndpoint, email, project);
            break;
        default:
            throw new Error(`Invalid resource: ${resource}`);
    }
    return thisGenerator.generate(stage);
}

interface ResourceGeneratorProcessState {
    stage: string;
}

const user_project_org_project_data_resource_generator_process = `user_project/:org/:project/data/:resource/generator/process`;
app.post(`${api_root_endpoint}/${user_project_org_project_data_resource_generator_process}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return res;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }

            return res.status(400).send('Invalid resource path');
        }
        const { _, __, resource } = req.params;
        if (!resource) {
            console.error(`Resource is required`);
            return res.status(400).send('Invalid resource path');
        }

        let body = req.body;
        let resourceGeneratorProcessState : ResourceGeneratorProcessState | undefined = undefined;
        if (body) {
            if( typeof body !== 'string') {
                if (Buffer.isBuffer(body) || Array.isArray(body)) {
                    body = Buffer.from(body).toString('utf8');
                } else {
                    body = JSON.stringify(body);
                }
            }
            let input : ResourceGeneratorProcessState;
            if (body) {
                try {
                    input = JSON.parse(body);
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                    return res.status(400).send('Invalid JSON Body');
                }

                resourceGeneratorProcessState = {
                    stage: input.stage
                };
            }
        }

        const loadedProjectData = await loadProjectData(email, org, project) as UserProjectData | Response;
        if (!loadedProjectData) {
            return res.status(404).send('Project not found');
        }
        const projectData = loadedProjectData as UserProjectData;

        // Launch the processing task
        let selfEndpoint = `${req.protocol}://${req.get('host')}`;
        // if we're running locally, then we'll use http:// no matter what
        if (req.get('host')!.includes('localhost')) {
            selfEndpoint = `http://${req.get('host')}`;
        }

        try {
            const nextStage : string = await processStage(selfEndpoint, email, projectData, resource, resourceGeneratorProcessState?.stage);
            const nextGeneratorState : ResourceGeneratorProcessState = {
                stage: nextStage
            };

            return res
                .status(200)
                .contentType('application/json')
                .send(nextGeneratorState);
        } catch (error) {
            if (error instanceof GeneratorProcessingError) {
                const processingError = error as GeneratorProcessingError;
                if (processingError.stage != resourceGeneratorProcessState?.stage) {
                    console.error(`${req.originalUrl}: Resetting to ${processingError.stage} due to error in ${resource} stage ${resourceGeneratorProcessState?.stage}:`, processingError);
            
                    const nextGeneratorState : ResourceGeneratorProcessState = {
                        stage: processingError.stage
                    };
        
                    return res
                        .status(200)
                        .contentType('application/json')
                        .send(nextGeneratorState);
                }
            }

            console.error(`Error processing stage ${resourceGeneratorProcessState?.stage}:`, error);
            throw error;
        }
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const user_project_org_project_data_references = `user_project/:org/:project/data_references`;

const userProjectDataReferences = async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }

            return res.status(400).send('Invalid resource path');
        }

        const userProjectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!userProjectData) {
            return res.status(404).send('Project not found');
        }

        if (!userProjectData.resources || userProjectData.resources.length === 0) {
            console.warn(`No resources found in project: ${userProjectData.org}/${userProjectData.name}`);

            // if we have no resources, we won't generate any data files
            // in the future, we should support generating blank or minimal data files so user can chat without Repository data
            return res
                .status(200)
                .contentType('application/json')
                .send([]);
        }
        const uri = new URL(userProjectData.resources[0].uri);

        console.log(`${user_project_org_project_data_references}: Request validated uri: ${uri}`);

        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            console.error(`Invalid URI: ${uri}`);
            return res.status(400).send('Invalid URI');
        }

        const projectDataFileIds = [];
        const projectDataNames = [];
        const projectDataTypes = [];

        projectDataTypes.push(ProjectDataType.ProjectSource);
        projectDataNames.push(ProjectDataFilename.ProjectSource);

        projectDataTypes.push(ProjectDataType.ProjectSpecification);
        projectDataNames.push(ProjectDataFilename.ProjectSpecification);

        projectDataTypes.push(ProjectDataType.ArchitecturalBlueprint);
        projectDataNames.push(ProjectDataFilename.ArchitecturalBlueprint);

        try {
            for (let i = 0; i < projectDataTypes.length; i++) {
                let projectData = await getCachedProjectData(email, SourceType.GitHub, ownerName, repoName, "", projectDataTypes[i]);
                if (!projectData) {
                    // data not found in KV cache - must be manually uploaded for now per project
                    console.log(`${user_project_org_project_data_references}: no data found for ${projectDataTypes[i]}`);

                    // we can't upload since we don't have all the resources yet
                    return res
                        .status(204)
                        .send(`No data found for ${projectDataTypes[i]}`);
                }

                console.log(`${user_project_org_project_data_references}: retrieved project data for ${projectDataTypes[i]}`);

                try {
                    const storedProjectDataId = await uploadProjectDataForAIAssistant(`${userProjectData.org}_${userProjectData.name}`, uri, projectDataTypes[i], projectDataNames[i], projectData);
                    console.log(`${user_project_org_project_data_references}: found File Id for ${projectDataTypes[i]} under ${projectDataNames[i]}: ${JSON.stringify(storedProjectDataId)}`);

                    projectDataFileIds.push(storedProjectDataId);
                } catch (error) {
                    return handleErrorResponse(error, req, res, `Unable to store project data on AI Servers:`);
                }
            }
        } catch (error) {
            return handleErrorResponse(error, req, res, `Unable to retrieve project data`);
        }

        await storeProjectData(email, SourceType.General, userProjectData.org, userProjectData.name, '', 'data_references', JSON.stringify(projectDataFileIds));

        console.log(`${user_project_org_project_data_references}: stored data`);

        return res
            .status(200)
            .contentType('application/json')
            .send(projectDataFileIds);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
};

app.route(`${api_root_endpoint}/${user_project_org_project_data_references}`)
   .post(userProjectDataReferences)
   .put(userProjectDataReferences);

app.get(`${api_root_endpoint}/${user_project_org_project_data_references}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }

            return res.status(400).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(404).send('Project not found');
        }

        if (!projectData.resources || projectData.resources.length === 0) {
            console.error(`No resources found in project: ${projectData.org}/${projectData.name}`);
            return res.status(400).send('No resources found in project');
        }
        const uri = new URL(projectData.resources[0].uri);

        const dataReferencesRaw : any = await getProjectData(email, SourceType.General, projectData.org, projectData.name, '', 'data_references');
        if (!dataReferencesRaw) {
            console.error(`No resources found in project: ${projectData.org}/${projectData.name}`);
            return res.status(400).send('No data references found for project');
        }
        const dataReferences = JSON.parse(dataReferencesRaw) as ProjectDataReference[];

        return res
            .status(200)
            .contentType('application/json')
            .send(dataReferences);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_project_org_project_data_references}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`Org is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'data_references');
        console.log(`${user_project_org_project_data_references}: deleted data`);

        return res
            .status(200)
            .send();
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const files_source_owner_project_path_analysisType = `files/:source/:owner/:project/:pathBase64/:analysisType`;
app.delete(`${api_root_endpoint}/${files_source_owner_project_path_analysisType}`, async (req, res) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { source, owner, project, pathBase64, analysisType } = req.params;

        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            if (!source) {
                console.error(`Source is required`);
            } else if (!owner) {
                console.error(`Owner is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            else if (!pathBase64) {
                console.error(`Path is required`);
            }
            else if (!analysisType) {
                console.error(`Analysis type is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(400).send(`Invalid resource path`);
        }

        await deleteProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType);

        console.log(`analysis data: deleted data`);

        return res
            .status(200)
            .send();

    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.get(`${api_root_endpoint}/${files_source_owner_project_path_analysisType}`, async (req, res) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { source, owner, project, pathBase64, analysisType } = req.params;

        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            if (!source) {
                console.error(`Source is required`);
            } else if (!owner) {
                console.error(`Owner is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            else if (!pathBase64) {
                console.error(`Path is required`);
            }
            else if (!analysisType) {
                console.error(`Analysis type is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(400).send(`Invalid resource path`);
        }

        const data = await getProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType);
        if (!data) {
            console.error(`Resource not found: ${source}, ${owner}, ${project}, ${decodedPath}, ${analysisType}`);
            return res.status(404).send('Resource not found');
        }

        return res.status(200).contentType('text/plain').send(data);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.post(`${api_root_endpoint}/${files_source_owner_project_path_analysisType}`, async (req, res) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return res.status(401).send('Unauthorized');
        }

        const { source, owner, project, pathBase64, analysisType } = req.params;

        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            console.error('Missing required parameters in request:', req.params);
            return res.status(400).send('Invalid resource path');
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(400).send('Invalid resource path');
        }

        const data = req.body; // Assuming data is sent directly in the body
        if (!data) {
            return res.status(400).send('No data provided');
        }

        await storeProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType, data);
        res.sendStatus(200);

    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const proxy_ai_endpoint = "proxy/ai/:org/:endpoint";
const secondsBeforeRequestTimeout = 25;
const handleProxyRequest = async (req: Request, res: Response) => {
    logRequest(req);

    try {
        const org = req.params.org;
        const endpoint = req.params.endpoint;

        const email = await validateUser(req, res);
        if (!email) {
            return res.status(401).send('Unauthorized');
        }

        console.log(`Proxy request by ${email}: ${endpoint}`);

        const signedIdentity = await signedAuthHeader(email, org);

        let externalEndpoint;
        if (req.get('host')!.includes('localhost')) {
            // this is the default local endpoint of the boost AI lambda python (chalice) server
            externalEndpoint = `http://localhost:8000/${endpoint}`;
        } else {
            externalEndpoint = Endpoints.get(endpoint as Services);
        }

        const axiosOptions = {
            method: req.method as any,
            url: externalEndpoint,
            headers: {
                'Accept': 'application/json',
                ...signedIdentity
            },
            data: (req.method !== 'GET' && req.method !== 'HEAD') ? req.body : undefined,
            timeout: secondsBeforeRequestTimeout * 1000
        };

        const startTimeOfCall = Date.now();
        try {
            const response = await axios(axiosOptions);
            const endTimeOfCall = Date.now();

            console.log(`Proxy response: ${response.status} ${response.statusText} (${(endTimeOfCall - startTimeOfCall) / 1000} seconds)`);

            return res
                .status(response.status)
                .contentType('application/json')
                .send(response.data);
        } catch (error) {
            const endTimeOfCallError = Date.now();
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                    console.error(`Error: TIMEOUT: Request to ${externalEndpoint} timed out after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error);
                } else if (error.response) {
                    console.error(`Error: Server responded with status ${error.response.status} ${error.response.statusText} after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error);
                    return res.status(error.response.status).send(error.response.statusText);
                } else if (error.request) {
                    console.error(`Error: No response received from ${externalEndpoint} after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error);
                } else {
                    console.error(`Error: Request setup failed for ${externalEndpoint} after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error);
                }
            } else {
                console.error(`Unknown error during proxy request for ${externalEndpoint} after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error);
            }
            return res.status(500).send('Internal Server Error');
        }
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
};

app.route(`${api_root_endpoint}/${proxy_ai_endpoint}`)
   .all(handleProxyRequest);

interface UserAccountState {
    enabled: boolean,
    status: string,
    org: string,
    owner: string,
    plan: string,
    saas_client: boolean,
    email: string,
    portal_url: string,
};

const user_org_account = `user/:org/account`;
app.get(`${api_root_endpoint}/${user_org_account}`, async (req, res) => {

    logRequest(req);

    try {

        const org = req.params.org;

        const email = await validateUser(req, res);
        if (!email) {
            return res.status(401).send('Unauthorized');
        }

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(401)
                .send('Unauthorized');
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `proxy/ai/${org}/${Services.CustomerPortal}`, "GET");

        return res
            .status(200)
            .contentType('application/json')
            .send(accountStatus);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const user_profile = `user/profile`;
app.delete(`${api_root_endpoint}/${user_profile}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        await deleteProjectData(email, SourceType.General, 'user', '', '', 'profile');
        console.log(`${user_profile}: deleted data`);

        return res
            .status(200)
            .send();
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

interface UserProfile {
    name?: string,
    title?: string,
    details?: string,
};

app.put(`${api_root_endpoint}/${user_profile}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        // if req body is not a string, then we need to convert back into a normal string
        let body = req.body;
        if (typeof body !== 'string') {
            if (Buffer.isBuffer(body)) {
                body = Buffer.from(body).toString('utf8');
            }
            else if (Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            } else {
                body = JSON.stringify(body);
            }
        }
        if (body === '') {
            console.error(`${user_profile}: empty body`);
            return res.status(400).send('Missing body');
        }

        let newProfileData : UserProfile;
        try {
            newProfileData = JSON.parse(body) as UserProfile;
        } catch (error) {
            console.error(`Error parsing JSON: ${body}`, error);
            return res.status(400).send('Invalid JSON Body');
        }
        const profileData: UserProfile = {};
        profileData.name = newProfileData.name;
        profileData.title = newProfileData.title;
        profileData.details = newProfileData.details;
        await storeProjectData(email, SourceType.General, 'user', '', '', 'profile', JSON.stringify(profileData));

        console.log(`${user_profile}: stored data`);

        return res
            .status(200)
            .contentType('application/json')
            .send(profileData);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.get(`${api_root_endpoint}/${user_profile}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const profileRaw = await getProjectData(email, SourceType.General, 'user', '', '', 'profile');
        let profileData: UserProfile = {};
        if (profileRaw) {
            profileData = JSON.parse(profileRaw) as UserProfile;
        }

        return res
            .status(200)
            .contentType('application/json')
            .send(profileData);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

interface ServiceStatusState {
    version: string;
    status: string;
    type: string
}

const api_status = `status`;
app.get(`${api_root_endpoint}/${api_status}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        // get the version from the environment variable APP_VERSION
        const version = process.env.APP_VERSION;
        if (!version) {
            console.error(`Missing APP_VERSION environment variable`);
            return res.status(500).send('Internal Server Error');
        }
        const type = process.env.DEPLOYMENT_STAGE;
        if (!type) {
            console.error(`Missing DEPLOYMENT_STAGE environment variable`);
            return res.status(500).send('Internal Server Error');
        }

        const status : ServiceStatusState = {
            version: version,
            status: 'available',
            type: type,
        };

        return res
            .status(200)
            .contentType('application/json')
            .send(status);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.get("/test", (req: Request, res: Response, next) => {

    try {
        logRequest(req);

        return res
            .status(200)
            .contentType("text/plain")
            .send("Test HTTP GET Ack");
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

import { AuthType } from './auth';

let existingInterval : NodeJS.Timeout | undefined = undefined;
const api_timer_config = `timer/config`;
app.post(`${api_root_endpoint}/${api_timer_config}`, async (req: Request, res: Response, next) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        const milliseconds = 1000;
        const defaultInterval = 5 * 60;

        // if caller posted a body, and the body is a JSON version of a number, then that's the interval (in seconds) we'll use
        // if body is empty, then default to 5 minutes
        let body = req.body;
        if (typeof body !== 'string') {
            if (Buffer.isBuffer(body) || Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            } else {
                body = JSON.stringify(body);
            }
        }
        let groomingInterval : number;
        if (!body) {
            groomingInterval = defaultInterval;
        } else {
            try {
                groomingInterval = parseInt(body);
            } catch (error) {
                console.error(`Error parsing numeric: ${body}`, error);
                return res.status(400).send('Invalid Numberic Body');
            }
        }

        // Timer API request function
        const callTimerAPI = async () => {
            try {
                const identityHeader = await signedAuthHeader(local_sys_admin_email)
                const data = await localSelfDispatch<string>("", identityHeader[header_X_Signed_Identity], req, `timer/interval`, "POST");
                console.log('Timer API Response:', data);
            } catch (error: any) {
                console.error(`Error calling Timer API: ${error}`);
            }
        };

        if (!process.env.IS_OFFLINE) {
            // if we're in AWS - and not running offline - then fail this call with a 400
            console.error(`Timer API is not available in AWS`);
            return res.status(400).send('Bad Request');
        }

        if (groomingInterval === -1) {

            // call the timing interval immediately/directly
            await callTimerAPI();

            return res
                .status(200)
                .contentType("application/json")
                .send(groomingInterval.toString());
        }

        // Set up the repeating interval in local Serverless offline env
        if (existingInterval) {
            console.log(`Clearing existing Timer API interval`);
            clearInterval(existingInterval!);
        }

        if (groomingInterval === 0) {
            console.log(`Timer API interval disabled`);
        } else {
            console.log(`Setting up Timer API interval for every ${groomingInterval} seconds`);
            existingInterval = setInterval(callTimerAPI, groomingInterval * milliseconds);
        }
        
        // return the new timer interval
        return res
            .status(200)
            .contentType("application/json")
            .send(groomingInterval.toString());
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const api_timer_interval = `timer/interval`;
app.post(`${api_root_endpoint}/${api_timer_interval}`, async (req: Request, res: Response, next) => {

    logRequest(req);
    try {
        const email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        const currentTimeinSeconds = Math.floor(Date.now() / 1000);

        // run the project groomer
        const originalIdentity = getSignedIdentityFromHeader(req);
        if (!originalIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(401)
                .send('Unauthorized');
        }

        try {
            // async launch of groom projects process (no "await")
            localSelfDispatch<void>("", originalIdentity, req, `groom/projects`, "POST");
        } catch (error) {
            console.error(`Timer Triggered: Error starting async groom projects process:`, error);
        }

        return res
            .status(200)
            .contentType("text/plain")
            .send(`Timer HTTP POST Ack: ${currentTimeinSeconds}`);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.post("/test", (req: Request, res: Response, next) => {

    try {
        logRequest(req);

        const data = req.body;

        return res
            .status(200)
            .contentType("text/plain")
            .send(`Test HTTP POST Ack: ${data}`);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

module.exports.handler = serverless(app);