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
    RepoDetails,
    verifyUserAccessToPrivateRepo
} from './github';
import {
    OpenAIFile,
    deleteAssistantFile,
    searchOpenAIFiles,
    uploadProjectDataForAIAssistant,
    deleteOpenAIFiles,
    searchOpenAIAssistants,
    OpenAIAssistant
} from './openai';
import { UserProjectData } from './types/UserProjectData';
import { GeneratorState, TaskStatus, Stages } from './types/GeneratorState';
import { ProjectResource } from './types/ProjectResource';
import axios from 'axios';
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
import {
    localSelfDispatch,
    api_root_endpoint,
    secondsBeforeRestRequestMaximumTimeout,
    logRequest,
    handleErrorResponse,
    HTTP_SUCCESS,
    HTTP_FAILURE_INTERNAL_SERVER_ERROR,
    HTTP_FAILURE_NOT_FOUND,
    HTTP_FAILURE_BAD_REQUEST_INPUT,
    HTTP_FAILURE_UNAUTHORIZED,
    HTTP_FAILURE_BUSY,
    HTTP_SUCCESS_ACCEPTED,
    HTTP_SUCCESS_NO_CONTENT
} from './utility/dispatch';

import { usFormatter } from './utility/log';

export const app = express();

// set limits to 1mb for text and 10mb for json
app.use(express.json({ limit: '10mb' })); // Make sure to use express.json middleware to parse json request body
app.use(express.text({ limit: '5mb' })); // Make sure to use express.text middleware to parse text request body

/*
// Error handling middleware
app.use((err : any, req : Request, res : Response) => {
    console.error(`Request ${req} failed with error ${err}`);
    res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
});
*/

// for debugging only
if (process.env.IS_OFFLINE) {
//    process.env.SIMULATE_OPENAI_UPLOAD = 'true';
//    process.env.ONE_AI_SPEC = 'true';
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

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        const uri = new URL(projectData.resources[0].uri);
        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send(`Invalid URI: ${uri}`);
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        const { _, __, resource } = req.params;

        await saveProjectDataResource(email, ownerName, repoName, resource, '', body);

        const resourceStatus : ResourceStatusState = {
            lastUpdated: Math.floor(Date.now() / 1000)
        }

        await storeProjectData(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status", JSON.stringify(resourceStatus));

        return res.status(HTTP_SUCCESS).send();
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
        lastUpdated : projectData.lastUpdated? projectData.lastUpdated : (Date.now() / 1000).toString(),
    };

    // if we didn't have a timestamp on the project data, then let's add it now (temporary rebuild step of the data store)
    if (!projectData.lastUpdated) {
        console.warn(`loadProjectData: added lastUpdated to ${org}/${project}`);
        await storeProjectData(email, SourceType.General, org, project, '', 'project', JSON.stringify(userProjectData));
    }

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
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('URI or Repo/Path is required');
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
                    return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid encoded URI');
                }
            }

            try {
                uri = new URL(uriString as string);
            } catch (error) {
                console.error(`Invalid URI: ${uriString}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid URI');
            }
        } else if (repoString && pathString) {
            if (repoString.match(/%[0-9a-f]{2}/i)) {
                try {
                    repoString = decodeURIComponent(repoString);
                } catch (error) {
                    console.error(`Invalid encoded repo: ${repoString}`);
                    return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid encoded repo');
                }
            }
            try {
                repo = new URL(repoString as string);
            } catch (error) {
                console.error(`Invalid repo: ${repoString}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid repo');
            }
            if (pathString.match(/%[0-9a-f]{2}/i)) {
                try {
                    path = decodeURIComponent(pathString);
                } catch (error) {
                    console.error(`Invalid encoded path: ${pathString}`);
                    return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid encoded path');
                }
            } else {
                path = pathString;
            }
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Unauthorized: Signed Header missing`);
            return res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('URI is required');
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                console.error(`Invalid encoded URI: ${uriString}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid encoded URI');
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            console.error(`Invalid URI: ${uriString}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid URI');
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(HTTP_FAILURE_UNAUTHORIZED)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('URI is required');
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                console.error(`Invalid encoded URI: ${uriString}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid encoded URI');
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            console.error(`Invalid URI: ${uriString}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid URI');
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(HTTP_FAILURE_UNAUTHORIZED)
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
    express.text({ limit: '10mb' }),
    express.json({ limit: '10mb' }),
    async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            console.error(`URI is required`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('URI is required');
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                console.error(`Invalid encoded URI: ${uriString}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid encoded URI');
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            console.error(`Invalid URI: ${uriString}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid URI');
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(HTTP_FAILURE_UNAUTHORIZED)
                .send('Unauthorized');
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFullSourceFromRepo(email, uri, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const user_org_connectors_github_permission = `user/:org/connectors/github/access`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_permission}`,
    async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            console.error(`URI is required`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('URI is required');
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                console.error(`Invalid encoded URI: ${uriString}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid encoded URI');
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            console.error(`Invalid URI: ${uriString}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid URI');
        }

        // check if this user has access to this private repo
        const accessGranted : boolean = await verifyUserAccessToPrivateRepo(email, uri);

        res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(accessGranted);
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid URI');
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid Resource - must be Github');
        }
        // get the account status
        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(HTTP_FAILURE_UNAUTHORIZED)
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
            return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        let body = req.body;

        // Puts resources and/or guideline values to be updated into new object    
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
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }
        Object.assign(projectData, updates);

        projectData.lastUpdated = Date.now() / 1000;

        await storeProjectData(email, SourceType.General, org, project, '', 'project', JSON.stringify(projectData));

        const signedIdentity = (await signedAuthHeader(email))[header_X_Signed_Identity];

        // get the path of the project data uri - excluding the api root endpoint
        const projectDataPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
        try {
            await localSelfDispatch<void>(email, signedIdentity, req, `${projectDataPath}/discover`, 'POST');
        } catch (error) {
            console.error(`Unable to launch discovery for ${projectDataPath}`, error);
        }

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }


        // Parse the body string to an object
        let updatedProject;
        try {
            updatedProject = JSON.parse(body);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON');
        }

        const storedProject : UserProjectData = {
            org : org,
            name : project,
            guidelines : updatedProject.guidelines? updatedProject.guidelines : '',
            resources : updatedProject.resources? updatedProject.resources : [],
            lastUpdated : Date.now() / 1000,
        };

        const projectPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
        try {
            const currentProjectData = await localSelfDispatch<UserProjectData>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, projectPath, 'GET');

            // check if the current data is equivalent to the existing data, and if it is, then just return success and skip validation
            if (JSON.stringify(currentProjectData) === JSON.stringify(storedProject)) {
                return res
                    .status(HTTP_SUCCESS)
                    .contentType('application/json')
                    .send(storedProject);
            }
        } catch (error: any) {
            // check for HTTP_FAILURE_NOT_FOUND and ignore it - everything else, log and error and then continue
            if (!error.message.includes('failed with status 404')) {
                console.error(`Unable to retrieve current project data for ${projectPath} - just post the new data - due to ${error}`);
            }
        }

        // validate this user has access to these repositories
        if (await validateProjectRepositories(email, org, storedProject.resources, req, res)) {
            return res;
        }

        // refresh the project updated time - since we've finished validation
        storedProject.lastUpdated = Date.now() / 1000;

        await storeProjectData(email, SourceType.General, org, project, '', 'project', JSON.stringify(storedProject));

        // because the discovery process may take more than 15 seconds, we never want to fail the project creation
        //      no matter how long discovery takes or even if discovery runs
        // so we'll use the axios timeout to ensure we don't wait too long for the discovery process
        const maximumDiscoveryTimeoutOnProjectCreationInSeconds = 15;

        let selfEndpoint = `${req.protocol}://${req.get('host')}${req.originalUrl}/discover`;
        // if we're running locally, then we'll use http:// no matter what
        if (req.get('host')!.includes('localhost')) {
            selfEndpoint = `http://${req.get('host')}${req.originalUrl}/discover`;
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
                // This block is for handling errors, including HTTP_FAILURE_NOT_FOUND and HTTP_FAILURE_INTERNAL_SERVER_ERROR status codes
                if (axios.isAxiosError(error) && error.response) {
                    console.log(`TIMECHECK: ${org}:${project}:discovery failed ${error.response.status}:${error.response.data} - due to error: ${error}`);
                } else {
                    // Handle other errors (e.g., network errors)
                    console.log(`TIMECHECK: ${org}:${project}:discovery failed due to error: ${error}`);
                }
            }
        });

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        // for now, we're going to report the owner of the project as the email asking
        //      in the future, we may have owners of projects set as organizations
        projectData.owner = email;

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'project');

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid org');
        } else if (project && typeof project !== 'string') {
            console.error(`Project must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid project');
        } else if (user && typeof user !== 'string') {
            console.error(`User must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid user');
        }

        const projectDataList : UserProjectData[] = [];

        const projectDataRaw : any[] = await searchProjectData(user?user as string:searchWildcard, SourceType.General, org?org as string:searchWildcard, project?project as string:searchWildcard, "", 'project');

        if (!projectDataRaw) {
            console.error(`No projects found due to query failure`);
            return res
                .status(HTTP_FAILURE_INTERNAL_SERVER_ERROR)
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
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
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
            .status(HTTP_SUCCESS)
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

interface DiscoverState {
    resetResources?: boolean;
}

const user_project_org_project_discover = `user_project/:org/:project/discover`;
app.post(`${api_root_endpoint}/${user_project_org_project_discover}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        let body = req.body;
        let initializeResourcesToStart = false;
        if (body) {
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
            const discoverState : DiscoverState = JSON.parse(body);
            initializeResourcesToStart = discoverState.resetResources? discoverState.resetResources : false;
        }

        // take the original request uri and remove the trailing /discover to get the project data
        const originalUri = req.originalUrl;
        const projectDataUri = originalUri.substring(0, originalUri.lastIndexOf('/discover'));
        const projectDataPath = projectDataUri.substring(projectDataUri.indexOf("user_project"));

        const resourcesToGenerate = [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification];
        const signedIdentity = (await signedAuthHeader(email))[header_X_Signed_Identity];

        const startProcessing : GeneratorState = {
            status: TaskStatus.Processing,
            };

        // if the user wants to reset the resources, then we'll ask each generator to restart
        if (initializeResourcesToStart) {
            startProcessing.stage = Stages.Reset;
        }

        // kickoff project processing now, by creating the project resources in parallel
        //      We'll wait for up to 25 seconds to perform upload, then we'll do an upload
        //      with whatever we have at that time
        const generatorPromises = resourcesToGenerate.map(async (resource) => {
            const generatorPath = `${projectDataPath}/data/${resource}/generator`;

            try {
                const newGeneratorState = await localSelfDispatch<GeneratorState>(
                    email,
                    signedIdentity, 
                    req,
                    generatorPath,
                    'PUT',
                    startProcessing,
                    secondsBeforeRestRequestMaximumTimeout * 1000,
                    false);
                // check if we timed out, with an empty object
                if (Object.keys(newGeneratorState).length === 0) {
                    console.warn(`${req.originalUrl} Async generator for ${resource} timed out`);
                } else {
                    if (process.env.TRACE_LEVEL) {
                        console.log(`${req.originalUrl} New Generator State: ${JSON.stringify(newGeneratorState)}`);
                    }
                }
            } catch (error) {
                console.error(`Discovery unable to launch generator (continuing) for ${generatorPath}`, error);
            }
        });

        // Execute all generator creation operations in parallel
        await Promise.all(generatorPromises);

        // due to above resource generation timeout of 25 seconds, we should have about 5 seconds to
        //      do the upload, which should be adequate time (e.g. 2-3 seconds)

        // After all generators have been started, proceed with data references
        const existingDataReferences = await localSelfDispatch<ProjectDataReference[]>(
            email, 
            signedIdentity, 
            req, 
            `${projectDataPath}/data_references`, 
            'PUT');

        console.log(`Existing Data References: ${JSON.stringify(existingDataReferences)}`);

        return res.status(HTTP_SUCCESS).send(existingDataReferences);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }    
});

enum ProjectStatus {
    Unknown = 'Unknown',                                    // project not found
    OutOfDateProjectData = 'Out of Date Project Data',      // project data out of date with source (e.g. newer source)
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
    lastSynchronized?: number;
    activelyUpdating?: boolean;
    details?: string;
    lastUpdated: number;
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid body');
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        // Parse the body string to an object
        let updatedStatus;
        try {
            updatedStatus = JSON.parse(body);
            if (updatedStatus.status !== ProjectStatus.Unknown) {
                return res
                    .status(HTTP_FAILURE_BAD_REQUEST_INPUT)
                    .send('Invalid status - only Unknown status can be set');
            }
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON');
        }

        const { org, project } = req.params;

        const rawProjectStatusData = await getProjectData(email, SourceType.General, org, project, '', 'status');

        let projectStatus : ProjectStatusState | undefined = undefined;
        if (rawProjectStatusData) {
            projectStatus = JSON.parse(rawProjectStatusData) as ProjectStatusState;
            projectStatus.status = updatedStatus.status;

            await storeProjectData(email, SourceType.General, org, project, '', 'status', JSON.stringify(projectStatus));

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        } else {
            return res
                .status(HTTP_FAILURE_NOT_FOUND)
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
            // if no project, then just HTTP_FAILURE_NOT_FOUND so user knows not to ask again
            if (!projectData) {
                return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
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

        if (process.env.TRACE_LEVEL) {
            console.log(`Project Status: ${JSON.stringify(projectStatus)}`);
        }

        return res
            .status(HTTP_SUCCESS)
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
            lastSynchronized: undefined,
            synchronized: false,
            activelyUpdating: false,
            lastUpdated : Math.floor(Date.now() / 1000) // default something and refresh when saved
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
            console.error(`${req.originalUrl}: Project Data References not found; Project may not exist or hasn't been discovered yet: ${error}`);

            // we can continue on, since we're just missing the last synchronized time - which probably didn't happen anyway
        }

        for (const dataReference of dataReferences) {
            if (dataReference.lastUpdated) {
                // pick the newest lastUpdated date - so we report the last updated date of the most recent resource sync
                if (!projectStatus.lastSynchronized || projectStatus.lastSynchronized < dataReference.lastUpdated) {
                    projectStatus.lastSynchronized = dataReference.lastUpdated;
                }
                break;
            }
        }

        // get the project data
        let projectData : UserProjectData;
        try {
            projectData = await localSelfDispatch<UserProjectData>(email, getSignedIdentityFromHeader(req)!, req, projectDataUri, 'GET');
        } catch (error: any) {
            if (error.response && error.response.status === HTTP_FAILURE_NOT_FOUND) {
                console.error(`Project not found: ${projectDataUri}`);
                return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
            } else if (error.response && error.response.status === HTTP_FAILURE_UNAUTHORIZED) {
                console.error(`Unauthorized: ${projectDataUri}`);
                return res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
            }

            console.error(`Unable to get project data: ${projectDataUri}`, error);
            return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
        }

        const saveProjectStatusUpdate = async () => {
            // save the project status
            try {
                // set current timestamp
                projectStatus.lastUpdated = Math.floor(Date.now() / 1000);

                await storeProjectData(email, SourceType.General, org, project, '', 'status', JSON.stringify(projectStatus));

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
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        const missingResources : string[] = [];

        const lastResourceUpdatedTimeStamp : Map<string, number> = new Map<string, number>();
        for (const resource of [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification]) {
            // check if this resource exists, and get its timestamp
            let resourceStatus : ResourceStatusState;
            try {
                resourceStatus = await localSelfDispatch<ResourceStatusState>(email, getSignedIdentityFromHeader(req)!, req, `${projectDataUri}/data/${resource}/status`, 'GET');
                if (process.env.TRACE_LEVEL) {
                    console.debug(`Resource ${resource} Status: ${JSON.stringify(resourceStatus)}`);
                }
                if (resourceStatus.lastUpdated && resourceStatus.lastUpdated > 0) {
                    lastResourceUpdatedTimeStamp.set(resource, resourceStatus.lastUpdated);
                }
            } catch (error) {
                missingResources.push(resource);
            }
        }

        let lastResourceCompletedGenerationTime: number | undefined = undefined;
        let lastResourceGeneratingTime: number | undefined = undefined;
        let firstResourceGeneratingTime: number | undefined = undefined;

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

            // if this generator was last updated before the current known first generating time, then we'll assume it was the first
            firstResourceGeneratingTime = firstResourceGeneratingTime?
                Math.min(firstResourceGeneratingTime, generatorStatus.lastUpdated?generatorStatus.lastUpdated:firstResourceGeneratingTime):
                generatorStatus.lastUpdated;

            if (generatorStatus.stage !== Stages.Complete) {
                currentResourceStatus.push(generatorStatus.status);

                // we nede to determine if the generator is still processing, and if so, what the last updated time
                if (generatorStatus.status === TaskStatus.Processing) {
                    if (!lastResourceGeneratingTime) {
                        lastResourceGeneratingTime =  generatorStatus.lastUpdated;
                    } else if (!generatorStatus.lastUpdated) {
                        console.log(`Can't get last generated time for: ${resource}`);
                    } else if (lastResourceGeneratingTime < generatorStatus.lastUpdated) {
                        lastResourceGeneratingTime = generatorStatus.lastUpdated;
                    }
                }

                // if the generator is not completed, then we're not using the best resource data
                //      so even if we've synchronized, its only partial resource data (e.g. partial source, or incomplete blueprint)
                incompleteResources.push(resource);
                continue;
            }
            // if we've gotten here, then the generator is complete, so we'll use the last completed time
            if (!lastResourceCompletedGenerationTime || !generatorStatus.lastUpdated ||
                 lastResourceCompletedGenerationTime < generatorStatus.lastUpdated) {
                    // store the latest completion time
                lastResourceCompletedGenerationTime = generatorStatus.lastUpdated;
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
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        // if the first resource was generated BEFORE the current project timestamp, then at least one of our resources is out of date
        //      so we'll mark the whole project as out of date
        if (firstResourceGeneratingTime && projectData.lastUpdated > firstResourceGeneratingTime) {
            const projectLastUpdatedDate = new Date(projectData.lastUpdated * 1000);
            const firstResourceGeneratingDate = new Date(firstResourceGeneratingTime * 1000);

            projectStatus.status = ProjectStatus.OutOfDateProjectData;
            projectStatus.details = `Project was updated ${usFormatter.format(projectLastUpdatedDate)} since resources were last generated at ${usFormatter.format(firstResourceGeneratingDate)}`;

            console.error(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
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
                .status(HTTP_SUCCESS)
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
                .status(HTTP_SUCCESS)
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
                .status(HTTP_SUCCESS)
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
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        // now we have completed resources and previously synchronized data, so now we'll check if the resource data is newer than the
        //      last synchronized time for the AI server upload
        const outOfDateResources : ProjectDataType[] = [];
        let lastResourceUpdated : number = 0;
        for (const resource of [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification]) {
            const thisDataReference : ProjectDataReference | undefined = dataReferences.find(dataReference => dataReference.type === resource);

            if (lastResourceUpdatedTimeStamp.get(resource) && lastResourceUpdated < lastResourceUpdatedTimeStamp.get(resource)!) {
                lastResourceUpdated = lastResourceUpdatedTimeStamp.get(resource)!;
            }
            if (!thisDataReference || thisDataReference.lastUpdated < lastResourceUpdatedTimeStamp.get(resource)!) {
                outOfDateResources.push(resource);
            }
        }

        const lastResourceCompletedDate = new Date(lastResourceUpdated * 1000);

        // now that our resources have completed generation, we want to make sure the data_references timestamp is AFTER the generators completed
        //      otherwise, we'll report that the resources are not synchronized
        if (!projectStatus.lastSynchronized) {
            // if we've never synchronized the data, then report not synchronized
            projectStatus.status = ProjectStatus.ResourcesNotSynchronized;
            projectStatus.details = `Resources Completed Generation at ${usFormatter.format(lastResourceCompletedDate)} but never Synchronized to AI Servers`;
            console.error(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        if (outOfDateResources.length > 0) {
            // if the last resource completed generation time is newer than the last synchronized time, then we're out of date
            projectStatus.status = ProjectStatus.AIResourcesOutOfDate;
            const lastSynchronizedDate = new Date(projectStatus.lastSynchronized * 1000);
            projectStatus.details = `Resources Completed Generation at ${usFormatter.format(lastResourceCompletedDate)} is newer than last Synchronized AI Server at ${usFormatter.format(lastSynchronizedDate)}`;

            console.error(`Project Status ISSUE: ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        // we're all good - all data is up to date, resources completely generated and fully synchronized to AI Servers
        projectStatus.status = ProjectStatus.Synchronized;
        projectStatus.synchronized = true;
        projectStatus.details = `All Resources Completely Generated and Uploaded to AI Servers`;

        console.log(`Project Status SYNCHRONIZED: ${JSON.stringify(projectStatus)}`);

        await saveProjectStatusUpdate();

        return res
            .status(HTTP_SUCCESS)
            .send(projectStatus);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }    
});

enum GroomingStatus {
    Idle = 'Idle',
    Grooming = 'Grooming',
    Skipping = 'Skipping',
    Error = 'Error'
}

interface ProjectGroomState {
    status: GroomingStatus;
    status_details?: string;
    consecutiveErrors: number;
    lastDiscoveryStart?: number;
    lastUpdated: number;
}

const user_project_org_project_groom = `user_project/:org/:project/groom`;
app.get(`${api_root_endpoint}/${user_project_org_project_groom}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        const groomStatusRaw = await getProjectData(email, SourceType.General, org, project, '', 'groom');
        if (!groomStatusRaw) {
            return res
                .status(HTTP_FAILURE_NOT_FOUND)
                .send('Project Groom Status not found');
        }
        const groomStatus: ProjectGroomState = JSON.parse(groomStatusRaw);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(groomStatus);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const didLastDiscoverySucceedOrFail = (groomStatus: ProjectGroomState, projectStatus: ProjectStatusState) : boolean | undefined => {
    // if we didn't launch a discovery, then assume it would have succeeded
    if (!groomStatus.lastDiscoveryStart) {
        return true;
    }

    // if groomer launched after last project status then unknown
    if (groomStatus.lastDiscoveryStart > projectStatus.lastUpdated) {
        return undefined;
    }

    // if the last synchronized time of the project is before our groomer ran, then unknown
    if (projectStatus.lastSynchronized && groomStatus.lastDiscoveryStart >= projectStatus.lastSynchronized) {
        return undefined;
    }

    // if the project is synchronized and the groomer launched before the last synchronization, then we're good
    if (projectStatus.lastSynchronized &&
        groomStatus.lastDiscoveryStart < projectStatus.lastSynchronized) {
        return true;
    }

    // otherwise, we'll assume the groomer discovery launched before the last project update (or update attempt)
    //      and we're not synchronized - due to an error
    return false;
}

const MaxGroomingErrorsBeforeManualDiscovery = 3;

app.post(`${api_root_endpoint}/${user_project_org_project_groom}`, async (req: Request, res: Response) => {

    logRequest(req);

    try {

        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const projectGroomPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
        const projectPath = projectGroomPath.substring(0, projectGroomPath.lastIndexOf('/groom'));

        const callStart = Math.floor(Date.now() / 1000);
        const groomingCyclesToWaitForSettling = DefaultGroomingIntervalInMinutes * 2;

        const storeGroomingState = async (groomingState: ProjectGroomState) => {
            await storeProjectData(email, SourceType.General, req.params.org, req.params.project, '', 'groom', JSON.stringify(groomingState));
        }

        const currentGroomingStateRaw = await getProjectData(email, SourceType.General, req.params.org, req.params.project, '', 'groom');
        const currentGroomingState: ProjectGroomState | undefined = currentGroomingStateRaw?JSON.parse(currentGroomingStateRaw):undefined;

        if (currentGroomingState) {

            const cycleBusyWindowPercentage = 0.75; // don't overlap last 75% of the grooming cycle
            // we only run at most once every grooming cycle - with adjustment for lag (e.g. checking status took part of the last cycle)
            //  this ensures we settle whatever processing happened in the last cycle
            if (currentGroomingState.lastUpdated > (callStart - (cycleBusyWindowPercentage * DefaultGroomingIntervalInMinutes * 60))) {
                const nextOpeningDate = new Date((currentGroomingState.lastUpdated + ((1 - cycleBusyWindowPercentage) * DefaultGroomingIntervalInMinutes * 60)) * 1000);
                const groomerBusy : ProjectGroomState = {
                    status: GroomingStatus.Skipping,
                    status_details: `Last Grooming cycle still active - next opening at ${usFormatter.format(nextOpeningDate)}`,
                    consecutiveErrors: 0, // we're skipping so we don't know the error status
                    lastDiscoveryStart: currentGroomingState.lastDiscoveryStart,
                    lastUpdated: Math.floor(Date.now() / 1000)
                };
                return res
                    .status(429)
                    .send(groomerBusy);
            }

            // if the last discovery run was less than 2 cycles minutes ago, then we'll skip this run
            if (currentGroomingState.lastDiscoveryStart &&
                currentGroomingState.lastDiscoveryStart > (callStart - (groomingCyclesToWaitForSettling * 60))) {

                // we only skip if we were actively grooming before... otherwise, we'll just let it run
                //      (e.g. if we hit an error or another issue)
                if (currentGroomingState.status === GroomingStatus.Grooming) {

                    // return http busy request
                    const groomerBusy : ProjectGroomState = {
                        status: GroomingStatus.Skipping,
                        status_details: 'Grooming already in progress at ' + currentGroomingState.lastUpdated,
                        consecutiveErrors: 0, // we're skipping so we don't know the error status
                        lastDiscoveryStart: currentGroomingState.lastDiscoveryStart,
                        lastUpdated: Math.floor(Date.now() / 1000)
                    };
                    return res
                        .status(429)
                        .send(groomerBusy);
                }
            }
        }

        // we'll check the status of the project data
        let projectStatus : ProjectStatusState;
        try {
            projectStatus = await localSelfDispatch<ProjectStatusState>(email, getSignedIdentityFromHeader(req)!, req, `${projectPath}/status`, 'GET');
        } catch (error: any) {
            if (error.response && error.response.status === HTTP_FAILURE_NOT_FOUND) {
                console.error(`Project Status not found; Project may not exist or hasn't been discovered yet`);
                return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
            }
            return handleErrorResponse(error, req, res, `Unable to query Project Status`);
        }

        // if the project is actively updating/discovery, then groomer will be idle
        if (projectStatus.activelyUpdating) {
            const groomingState = {
                status: GroomingStatus.Skipping,
                status_details: 'Project is actively updating',
                consecutiveErrors: currentGroomingState?currentGroomingState.consecutiveErrors:0,
                lastDiscoveryStart: currentGroomingState?currentGroomingState.lastDiscoveryStart:undefined,
                lastUpdated: Math.floor(Date.now() / 1000)
            };

            await storeGroomingState(groomingState);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(groomingState);
        }

        // if project is synchronized, the nothing to do
        if (projectStatus.status === ProjectStatus.Synchronized) {
            const synchronizedDate = new Date(projectStatus.lastSynchronized! * 1000);
            const groomingState = {
                status: GroomingStatus.Idle,
                status_details: `Project is synchronized as of ${usFormatter.format(synchronizedDate)} - Idling Groomer`,
                consecutiveErrors: 0, // since the project synchronized, assume groomer did or could work, so reset the error counter
                lastDiscoveryStart: currentGroomingState?currentGroomingState.lastDiscoveryStart:undefined,
                lastUpdated: Math.floor(Date.now() / 1000)
            };
            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(groomingState);
        }

        const timeRemainingToDiscoverInSeconds = secondsBeforeRestRequestMaximumTimeout - (Math.floor(Date.now() / 1000) - callStart);
        // if we have less than one second to run discovery, just skip it for now, and we'll try again later (status refresh took too long)
        if (timeRemainingToDiscoverInSeconds <= 1) {
            const groomingState = {
                status: GroomingStatus.Skipping,
                status_details: `Insufficient time to rediscover: ${timeRemainingToDiscoverInSeconds} seconds remaining`,
                consecutiveErrors: currentGroomingState?currentGroomingState.consecutiveErrors:0,
                lastDiscoveryStart: currentGroomingState?currentGroomingState.lastDiscoveryStart:undefined,
                lastUpdated: Math.floor(Date.now() / 1000)
            };

            await storeGroomingState(groomingState);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(groomingState);
        }

        // get the result of the last discovery launched by discovery
        const lastDiscoveryResult: boolean | undefined = currentGroomingState?didLastDiscoverySucceedOrFail(currentGroomingState, projectStatus):undefined;

        // if last discovery result was a success - then we can re-run groomer discovery again
        if (lastDiscoveryResult === true) {
            // reset the error counter if we worked
            if (currentGroomingState?.consecutiveErrors) {
                currentGroomingState.consecutiveErrors = 0;
            }
        } else if (lastDiscoveryResult === false && currentGroomingState) {
            // if the last discovery failed, then we need to check if we reached our limit of errors
            //      that will block the groomer indefinitely from automatically launching discovery
            // to unblock groomer, discovery must be manually started

            // if we have reached our error limit, then we'll just skip grooming - and stay in error state
            if (currentGroomingState.consecutiveErrors >= MaxGroomingErrorsBeforeManualDiscovery) {
                const groomingState = {
                    status: GroomingStatus.Error,
                    status_details: `Groomer has reached maximum errors (${MaxGroomingErrorsBeforeManualDiscovery}) - Manual Discovery Required`,
                    lastDiscoveryStart: currentGroomingState.lastDiscoveryStart,
                    consecutiveErrors: currentGroomingState.consecutiveErrors,
                    lastUpdated: Math.floor(Date.now() / 1000)
                };

                await storeGroomingState(groomingState);

                return res
                    .status(HTTP_SUCCESS)
                    .contentType('application/json')
                    .send(groomingState);
            }

            currentGroomingState.consecutiveErrors++;
        } else {
            // if we don't know if the last discovery worked, or we're starting fresh (no current groomer state), then we'll just start grooming
            //      and we'll assume it will work
        }

        const originalIdentityHeader = getSignedIdentityFromHeader(req);
        const discoveryWithResetState : DiscoverState = {
            resetResources: true
        };

        const discoveryStart = Math.floor(Date.now() / 1000);
        const launchedGroomingState : ProjectGroomState = {
            status: GroomingStatus.Grooming,
            lastDiscoveryStart: discoveryStart,
            consecutiveErrors: currentGroomingState?currentGroomingState.consecutiveErrors:0,
            lastUpdated: Math.floor(Date.now() / 1000)
        };

        try {
            console.log(`Launching Groomed Discovery for ${projectPath} with status ${JSON.stringify(projectStatus)}`);

            const discoveryResult = await localSelfDispatch<ProjectDataReference[]>(
                email, originalIdentityHeader!, req,
                `${projectPath}/discover`, 'POST',
                projectStatus.status === ProjectStatus.OutOfDateProjectData?discoveryWithResetState:undefined,
                timeRemainingToDiscoverInSeconds * 1000);

                // if discovery result is an empty object (i.e. {}), then we launched discovery but don't know if it finished (e.g. timeout waiting)
            const discoveryTime = new Date(discoveryStart * 1000);
            if (!discoveryResult || !Object.keys(discoveryResult).length) {
                launchedGroomingState.status_details = `Launched Async Discovery at ${usFormatter.format(discoveryTime)}, but no result yet`;
            } else {
                // even though discovery launched, and didn't timeout... we don't know if it finished or not
                //      only that the async launch didn't timeout/fail
                launchedGroomingState.status_details = `Launched Discovery at ${usFormatter.format(discoveryTime)} ${JSON.stringify(discoveryResult)}`;
            }

            await storeGroomingState(launchedGroomingState);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(launchedGroomingState);
        } catch (error) {
            console.error(`Groomer unable to launch discovery for ${projectPath}`, error);

            launchedGroomingState.status = GroomingStatus.Error;
            launchedGroomingState.status_details = `Error launching discovery: ${error}`;
            launchedGroomingState.consecutiveErrors++;

            await storeGroomingState(launchedGroomingState);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(launchedGroomingState);
        }

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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'goals');

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        // Parse the body string to an object
        let updatedGoals;
        try {
            updatedGoals = JSON.parse(body);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON');
        }

        await storeProjectData(email, SourceType.General, org, project, '', 'goals', JSON.stringify(updatedGoals));

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectGoalsRaw = await getProjectData(email, SourceType.General, org, project, '', 'goals');

        let projectGoals : ProjectGoals = {};
        if (projectGoalsRaw) {
            projectGoals = JSON.parse(projectGoalsRaw);
        }

        return res
            .status(HTTP_SUCCESS)
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

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
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
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Resource not found');
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(resourceData);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

interface ResourceStatusState {
    lastUpdated: number;
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
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

        let resourceStatus : ResourceStatusState | undefined = undefined;
        let resourceStatusRaw = await getCachedProjectData(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status");
        resourceStatus = resourceStatusRaw?JSON.parse(resourceStatusRaw):undefined;
        if (!resourceStatusRaw || !resourceStatus?.lastUpdated) {
            // if the resource status was not found, check if the resource exists... we may just be missing the status
            // so we'll regenerate the status
            const resourceData = await getCachedProjectData(email, SourceType.GitHub, ownerName, repoName, '', resource);
            // resource doesn't exist, so just report missing/Not Found
            if (!resourceData) {
                console.error(`${user_project_org_project_data_resource_status}: not found: ${ownerName}/${repoName}/data/${resource}`);
                return res.status(HTTP_FAILURE_NOT_FOUND).send('Resource not found');
            }
            // resource exists, so we'll generate the status
            const resourceStatusWithTimestamp : ResourceStatusState = {
                lastUpdated: Math.floor(Date.now() / 1000)
            };
            resourceStatusRaw = JSON.stringify(resourceStatusWithTimestamp);
            await storeProjectData(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status", resourceStatusRaw);
            console.warn(`Missing status for resource ${req.originalUrl}: generating with current timestamp`);
        }

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
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

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
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

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
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
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send({
                    status: TaskStatus.Idle,
                } as GeneratorState);
        } else {

            const generatorData = JSON.parse(currentInput) as GeneratorState;

            return res
                .status(HTTP_SUCCESS)
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

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const loadedProjectData = await loadProjectData(email, org, project) as UserProjectData | Response;
        if (!loadedProjectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
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
            return res
                .status(HTTP_FAILURE_NOT_FOUND)
                .send('Generator not found');
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        let input : GeneratorState;
        try {
            input = JSON.parse(body);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON Body');
        }
        if (input.status !== currentGeneratorState.status) {
            console.error(`Invalid PATCH status: ${input.status}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send(`Invalid PATCH status: ${input.status}`)
        }
        if (input.lastUpdated) {
            currentGeneratorState.lastUpdated = input.lastUpdated;
        }
        if (input.status_details) {
            currentGeneratorState.status_details = input.status_details;
        }
        if (input.stage) {
            currentGeneratorState.stage = input.stage;
        }

        const updateGeneratorState = async (generatorState: GeneratorState) => {
            if (!generatorState.lastUpdated) {
                generatorState.lastUpdated = Math.floor(Date.now() / 1000);
            }

            await storeProjectData(email, SourceType.GitHub, ownerName, repoName, '', 
                `${resource}/generator`, JSON.stringify(generatorState));

            if (process.env.TRACE_LEVEL) {
                console.log(`${req.originalUrl}: Updated Generator: ${JSON.stringify(generatorState)}`);
            }
        };

        // if we're only updating the timestamp on the processing, then don't kick off any new work
        if (currentGeneratorState.status === TaskStatus.Processing) {

            console.log(`${user_project_org_project_data_resource_generator}: updated processing task: ${JSON.stringify(currentGeneratorState)}`);
            await updateGeneratorState(currentGeneratorState);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(currentGeneratorState);
        } else {
            // patch is only supported for processing tasks
            console.error(`Invalid PATCH status: ${currentGeneratorState.status}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send(`Invalid PATCH status: ${currentGeneratorState.status}`)
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

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const loadedProjectData = await loadProjectData(email, org, project) as UserProjectData | Response;
        if (!loadedProjectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }
        const projectData = loadedProjectData as UserProjectData;

        // if we have no resources to generate data from, then we're done
        if (!projectData.resources?.length) {
            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send({
                    status: TaskStatus.Idle,
                    stage: Stages.Complete,
                    lastUpdated: Math.floor(Date.now() / 1000),
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        let input : GeneratorState;
        try {
            input = JSON.parse(body);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON Body');
        }
        let userGeneratorRequest : GeneratorState = {
            status: input.status
        };

        const updateGeneratorState = async (generatorState: GeneratorState) => {
            if (!generatorState.lastUpdated) {
                generatorState.lastUpdated = Math.floor(Date.now() / 1000);
            }

            await storeProjectData(email, SourceType.GitHub, ownerName, repoName, '', 
                `${resource}/generator`, JSON.stringify(generatorState));
            if (process.env.TRACE_LEVEL) {
                console.log(`${user_project_org_project_data_resource_generator}: stored new state: ${JSON.stringify(generatorState)}`);
            }

            if (generatorState.status === TaskStatus.Processing) {
                // if we're still processing, then we'll skip a full project refresh and resource upload
                //  and wait for a terminal state - complete/idle or error
                return;
            } else if (generatorState.status === TaskStatus.Idle && generatorState.stage !== Stages.Complete) {
                // if we're idle, but not complete, then we'll skip a full project refresh and resource upload
            }

            // we have completed all stages or reached a terminal point (e.g. error or non-active updating)
            if (generatorState.status === TaskStatus.Idle && generatorState.stage === Stages.Complete) {
                console.debug(`${req.originalUrl}: Completed all stages`);
            } else if (generatorState.status === TaskStatus.Error) {
                console.debug(`${req.originalUrl}: Generator errored out: ${generatorState.status_details}`);
            }

            const projectStatusRefreshDelayInMs = 250;

            // force a refresh of the project status
            const projectStatusRefreshRequest : ProjectStatusState = {
                status: ProjectStatus.Unknown,
                lastUpdated: generatorState.lastUpdated
            };
            // we're going to start an async project status refresh (but only wait 250 ms to ensure it starts)
            try {
                await localSelfDispatch<ProjectStatusState>(
                    email, getSignedIdentityFromHeader(req)!, req,
                    `user_project/${org}/${project}/status`, 'PATCH', projectStatusRefreshRequest, projectStatusRefreshDelayInMs, false);
            } catch (error: any) {
                if (!error.response || error.response.status !== HTTP_FAILURE_NOT_FOUND) {
                    throw error;
                }
            }
            // upload what resources we have to the AI servers
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
                    currentGeneratorState.lastUpdated = undefined; // get a refreshed last updated timestamp 
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

                    const newGeneratorState = await localSelfDispatch<ResourceGeneratorProcessState>(email, getSignedIdentityFromHeader(req)!, req, pathToProcess, "POST", processNextStageState.stage?processNextStageState:undefined,
                        secondsBeforeRestRequestMaximumTimeout * 1000, false);
                    if (!newGeneratorState?.stage) {
                        throw new Error(`${req.originalUrl} Processor timed out ${processNextStageState.stage?processNextStageState.stage:"[Initializing]"} Stage`);
                    } else {
                        const processEndTime = Math.floor(Date.now() / 1000);
                        if (process.env.TRACE_LEVEL) {
                            console.log(`TIMECHECK: ${processNextStageState.stage?processNextStageState.stage:"[Initializing]"}: processing started:${processStartTime} ended:${processEndTime} (${processEndTime - processStartTime} seconds) - move to stage:${currentGeneratorState.stage}`);
                        }
                    }
                    currentGeneratorState.stage = newGeneratorState.stage;

                    // if we've finished all stages, then we'll set the status to complete and idle
                    if (currentGeneratorState.stage === Stages.Complete) {
                        console.log(`${req.originalUrl}: completed all stages`);

                        currentGeneratorState.status = TaskStatus.Idle;
                    }

                    await updateGeneratorState(currentGeneratorState);
                } catch (error) {
                    console.error(`Error processing stage ${currentGeneratorState.stage}:`, error);

                    if (error instanceof GeneratorProcessingError) {
                        const processingError = error as GeneratorProcessingError;
                        if (processingError.stage != currentGeneratorState.stage) {
                            console.error(`${req.originalUrl}: Resetting to ${processingError.stage} due to error in ${resource} stage ${currentGeneratorState.stage}:`, processingError);

                            currentGeneratorState.status_details = `Resetting to earlier stage ${processingError.stage} due to error: ${processingError}`;
                        } else {
                            currentGeneratorState.status_details = `Rerun current stage due to error: ${processingError}`;
                        }
                    } else {
                        currentGeneratorState.status_details = `${error}`;
                    }

                    // In case of error, set status to error
                    currentGeneratorState.status = TaskStatus.Error;
                    currentGeneratorState.lastUpdated = undefined; // get a refreshed last updated timestamp

                    await updateGeneratorState(currentGeneratorState);

                    // we errored out, so we'll return an error HTTP status code for operation failed, may need to retry
                    return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send();
                }

                // if we're processing and not yet completed the full stages, then we need to process the next stage
                if (currentGeneratorState.status === TaskStatus.Processing && currentGeneratorState.stage !== Stages.Complete) {
                    // we need to terminate the current call so we don't create a long blocking HTTP call
                    //      so we'll start a new async HTTP request - detached from the caller to continue processing
                    //      the next stage
                    if (process.env.TRACE_LEVEL) {
                        console.log(`${req.originalUrl}: starting async processing for ${JSON.stringify(currentGeneratorState)}`);
                    }

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
                    if (process.env.TRACE_LEVEL) {
                        console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} starting async processing`);
                    }
                    // we're going to wait for completion or 1 second to pass
                    await axios.put(selfEndpoint, newProcessingRequest, {
                            headers: {
                                'Content-Type': 'application/json',
                                ...authHeader,
                            },
                            timeout: 1000 })
                        .then(response => {
                            // if the new task stage completes in 1 seconds, we'll wait...
                            if (process.env.TRACE_LEVEL) {
                                console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} completed async processing`);
                            }
                        })
                            // otherwise, we'll move on
                        .catch(error => {
                            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                                if (process.env.TRACE_LEVEL) {
                                    console.log(`TIMECHECK: TIMEOUT: ${org}:${project}:${resource}:${currentGeneratorState.stage} async processing timed out after 1 seconds`);
                                }
                            } else {
                                // This block is for handling errors, including HTTP_FAILURE_NOT_FOUND and HTTP_FAILURE_INTERNAL_SERVER_ERROR status codes
                                if (axios.isAxiosError(error) && error.response) {
                                    console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} async processing failed due to error: ${error.response.status}:${error.response.statusText} due to error:${error}`);
                                } else {
                                    // Handle other errors (e.g., network errors)
                                    console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} failed async processing ${error}`);
                                }
                            }
                        });
                    if (process.env.TRACE_LEVEL) {
                        console.log(`TIMECHECK: ${org}:${project}:${resource}:${currentGeneratorState.stage} After async processing`);
                    }

                    // Return a response immediately without waiting for the async process
                    return res
                        .status(HTTP_SUCCESS_ACCEPTED)
                        .contentType('application/json')
                        .send(currentGeneratorState);
                }
            } else if (userGeneratorRequest.status === TaskStatus.Idle) {
                if (process.env.TRACE_LEVEL) {
                    console.log(`${req.originalUrl}: idle task: ${JSON.stringify(userGeneratorRequest)}`);
                }

                if (currentGeneratorState.status === TaskStatus.Processing) {
                    // if we have been processing for less than 3 minutes, then we'll return busy HTTP status code
                    //      We choose 3 minutes because the forked rate above waits 2 seconds before returning
                    //      so if a new task runs, we'd expect to update processing time at least every 1-2 minutes
                    if (currentGeneratorState.lastUpdated &&
                        currentGeneratorState.lastUpdated > (Math.floor(Date.now() / 1000) - 60 * MinutesToWaitBeforeGeneratorConsideredStalled)) {
                        // if caller wants us to be idle, and we're busy processing, we'll return busy HTTP
                        //      status code
                        return res
                            .status(HTTP_FAILURE_BUSY)
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
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send();
            } else {
                // external caller can't set the status to unknown, so we'll return bad input HTTP status code
                console.error(`Invalid input status: ${userGeneratorRequest.status}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send();
            }
        } catch (error) {
            return handleErrorResponse(error, req, res, `Unable to handle task request`);
        }

        return res
            .status(HTTP_SUCCESS)
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
        console.log(`${project.org}:${project.name} Processing ${resource} stage ${stage}...`);
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

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }
        const { _, __, resource } = req.params;
        if (!resource) {
            console.error(`Resource is required`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
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
                    return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON Body');
                }

                resourceGeneratorProcessState = {
                    stage: input.stage
                };
            }
        }

        const loadedProjectData = await loadProjectData(email, org, project) as UserProjectData | Response;
        if (!loadedProjectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
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
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(nextGeneratorState);
        } catch (error) {

            let currentStage = resourceGeneratorProcessState?.stage;
            if (!currentStage) {
                currentStage = "[Current Stage";
            }

            if (error instanceof GeneratorProcessingError) {
                const processingError = error as GeneratorProcessingError;
                if (processingError.stage != currentStage) {
                    console.error(`${req.originalUrl}: Resetting to ${processingError.stage} due to error in ${resource} stage ${currentStage}:`, processingError);
            
                    const nextGeneratorState : ResourceGeneratorProcessState = {
                        stage: processingError.stage
                    };
        
                    return res
                        .status(HTTP_SUCCESS)
                        .contentType('application/json')
                        .send(nextGeneratorState);
                }
            }

            console.error(`Error processing stage ${currentStage}:`, error);

            throw error;
        }
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const userProjectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!userProjectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        if (!userProjectData.resources || userProjectData.resources.length === 0) {
            console.warn(`No resources found in project: ${userProjectData.org}/${userProjectData.name}`);

            // we reset the project data references to empty - since we have no resources to upload, and we want to update the cache
            const emptyProjectDataFileIds: ProjectDataReference[] = [];
            await storeProjectData(email, SourceType.General, userProjectData.org, userProjectData.name, '', 'data_references', JSON.stringify(emptyProjectDataFileIds));

            // if we have no resources, we won't generate any data files
            // in the future, we should support generating blank or minimal data files so user can chat without Repository data
            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(emptyProjectDataFileIds);
        }
        const repoUri = new URL(userProjectData.resources[0].uri);

        // Split the pathname by '/' and filter out empty strings
        const pathSegments = repoUri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            console.error(`Invalid URI: ${repoUri}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid URI');
        }

        const projectDataNames = [];
        const projectDataTypes = [];

        projectDataTypes.push(ProjectDataType.ProjectSource);
        projectDataNames.push(ProjectDataFilename.ProjectSource);

        projectDataTypes.push(ProjectDataType.ProjectSpecification);
        projectDataNames.push(ProjectDataFilename.ProjectSpecification);

        projectDataTypes.push(ProjectDataType.ArchitecturalBlueprint);
        projectDataNames.push(ProjectDataFilename.ArchitecturalBlueprint);

        const existingProjectFileIdsRaw = await getProjectData(email, SourceType.General, userProjectData.org, userProjectData.name, '', 'data_references');
        let existingProjectFileIds: Map<string, ProjectDataReference> = new Map();
        if (existingProjectFileIdsRaw) {
            const loadedProjectFileIds = JSON.parse(existingProjectFileIdsRaw) as ProjectDataReference[];
            loadedProjectFileIds.map((projectDataReference) => {
                existingProjectFileIds.set(projectDataReference.type, projectDataReference);
            });
        }

        const missingDataTypes: string[] = [];
        const uploadFailures: Map<string, Error> = new Map();
        let refreshedProjectData = false;
        try {
            for (let i = 0; i < projectDataTypes.length; i++) {
                let projectData = await getCachedProjectData(email, SourceType.GitHub, ownerName, repoName, "", projectDataTypes[i]);
                if (!projectData) {
                    if (process.env.TRACE_LEVEL) {
                        console.log(`${req.originalUrl}: no data found for ${projectDataTypes[i]}`);
                    }
                    missingDataTypes.push(projectDataTypes[i]);
                    continue;
                }

                try {
                    let resourceStatus = await localSelfDispatch<ResourceStatusState>(email, getSignedIdentityFromHeader(req)!, req,
                        `user_project/${org}/${project}/data/${projectDataTypes[i]}/status`, 'GET');
                    const lastUploaded = existingProjectFileIds.get(projectDataTypes[i])?.lastUpdated;

                    // there is a small race window here where an older resource version be uploaded, and before the upload
                    //      a newer resource version is stored - but since the upload timestamp is AFTER the newer version was stored
                    //      the newer version will not be uploaded. This would be fixed by storing a hash or timestamp of the resource
                    //      uploaded and storing that in the project data reference as well - but for now, we'll ignore it, since
                    //      this is a small window, and ANY future upload of the resource will resolve the issue.
                    const resourceStatusDate = new Date(resourceStatus.lastUpdated * 1000);
                    const lastUploadedDate = lastUploaded?new Date(lastUploaded * 1000):undefined;
                    const timeDifference = lastUploadedDate?resourceStatusDate.getTime() - lastUploadedDate.getTime():undefined;
                    const timeDifferenceInSeconds = timeDifference?timeDifference / 1000:0;

                    if (lastUploaded && lastUploaded > resourceStatus.lastUpdated) {
                        console.debug(`${req.originalUrl}: Skipping upload of ${projectDataTypes[i]} - likely uploaded at ${usFormatter.format(lastUploadedDate)} and resource updated at ${usFormatter.format(resourceStatusDate)}`);
                        continue;
                    }

                    if (lastUploaded) {
                        console.debug(`${req.originalUrl}: Uploading ${projectDataTypes[i]} (${projectData.length} bytes) from ${usFormatter.format(resourceStatusDate)}: ${timeDifferenceInSeconds} seconds out of sync; last uploaded at ${usFormatter.format(lastUploadedDate)}`);
                    } else {
                        console.debug(`${req.originalUrl}: Uploading ${projectDataTypes[i]} (${projectData.length} bytes) from ${usFormatter.format(resourceStatusDate)}: never uploaded"}`);
                    }
                } catch (error) {
                    console.error(`${req.originalUrl} Uploading ${projectDataTypes[i]} (${projectData.length} bytes) due to error checking last upload time: `, error);
                }
                
                if (process.env.TRACE_LEVEL) {
                    console.log(`${user_project_org_project_data_references}: retrieved project data for ${projectDataTypes[i]}`);
                }

                try {

                    const storedProjectDataId = await uploadProjectDataForAIAssistant(email, userProjectData.org, userProjectData.name, repoUri, projectDataTypes[i], projectDataNames[i], projectData);
                    if (process.env.TRACE_LEVEL) {
                        console.log(`${user_project_org_project_data_references}: found File Id for ${projectDataTypes[i]} under ${projectDataNames[i]}: ${JSON.stringify(storedProjectDataId)}`);
                    }
                    refreshedProjectData = true;

                    // update the existing resources with the newly uploaded info
                    const previousProjectFileId = existingProjectFileIds.get(projectDataTypes[i])?.id;
                    if (previousProjectFileId) {
                        await delay(1000); // one second delay to avoid getting throttled by OpenAI for above upload (60 calls / min)
                        try {
                            await deleteAssistantFile(previousProjectFileId);
                        } catch (error) { // we're going to ignore failure to delete and keep going... auto groomer will cleanup later
                            console.error(`${req.originalUrl} Unable to delete previous Project File Resource ${projectDataTypes[i]} ${previousProjectFileId}:`, error);
                        }
                    }
                    existingProjectFileIds.set(projectDataTypes[i], storedProjectDataId);

                } catch (error: any) {
                    if (error.message?.includes("exceeded")) {
                        // If rate limit exceeded error is detected, fail immediately - don't continue AI uploads
                        return handleErrorResponse(error, req, res, `Rate Limit Exceeded: ${error}`);
                    }
                    
                    // continue trying to upload all resources we can - and record the failures
                    uploadFailures.set(projectDataTypes[i], error);
                    continue;
                }
                // if we have at least one more cycle, then we'll wait 2 seconds before continuing
                if (i < projectDataTypes.length - 1) {
                    await delay(2000);
                }
            }
        } catch (error) {
            return handleErrorResponse(error, req, res, `Unable to retrieve project data`);
        }

        if (missingDataTypes.length > 0) {
            if (missingDataTypes.length < projectDataTypes.length) {
                console.warn(`${req.originalUrl}: Missing data for ${missingDataTypes.join(", ")}`);
            } else {
                return res.status(HTTP_SUCCESS_NO_CONTENT).send(`No data found for ${missingDataTypes.join(", ")}`);
            }
        }

        if (uploadFailures.size > 0) {
            // Convert Map keys and values to arrays for processing
            const failedKeys = Array.from(uploadFailures.keys());
            const failedValues = Array.from(uploadFailures.values());
            if (uploadFailures.size < projectDataTypes.length) {
                console.warn(`${req.originalUrl}: Failed to upload data for ${failedKeys.join(", ")}`);
            } else {
                // Handle the first error specifically
                return handleErrorResponse(failedValues[0], req, res, `Unable to store project data on AI Servers:`);
            }
        }

        // extract the file ids from the map (previous and any updated)
        const projectDataFileIds = Array.from(existingProjectFileIds.values());

        if (refreshedProjectData) {
            await storeProjectData(email, SourceType.General, userProjectData.org, userProjectData.name, '', 'data_references', JSON.stringify(projectDataFileIds));

            // now refresh project status since we've completed uploads
            const projectStatusRefreshDelayInMs = 250;
            const projectStatusRefreshRequest : ProjectStatusState = {
                status: ProjectStatus.Unknown,
                lastUpdated: Date.now() / 1000
            };
            try {
                await localSelfDispatch<ProjectStatusState>(
                    email, getSignedIdentityFromHeader(req)!, req,
                    `user_project/${org}/${project}/status`, 'PATCH', projectStatusRefreshRequest, projectStatusRefreshDelayInMs, false);
            } catch (error: any) {
                if (!error.response || error.response.status !== HTTP_FAILURE_NOT_FOUND) {
                    throw error;
                }
            }
        }

        return res
            .status(HTTP_SUCCESS)
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

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project) as UserProjectData;
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        if (!projectData.resources || projectData.resources.length === 0) {
            console.error(`No resources found in project: ${projectData.org}/${projectData.name}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('No resources found in project');
        }
        const uri = new URL(projectData.resources[0].uri);

        const dataReferencesRaw : any = await getProjectData(email, SourceType.General, projectData.org, projectData.name, '', 'data_references');
        if (!dataReferencesRaw) {
            console.error(`No resources found in project: ${projectData.org}/${projectData.name}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('No data references found for project');
        }
        const dataReferences = JSON.parse(dataReferencesRaw) as ProjectDataReference[];

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const dataReferencesRaw = await getProjectData(email, SourceType.General, org, project, '', 'data_references');
        if (!dataReferencesRaw) {

            console.warn(`${req.originalUrl} No data references found for DELETE`);

        } else {
            const dataReferences = JSON.parse(dataReferencesRaw) as ProjectDataReference[];
            for (let i = 0; i < dataReferences.length; i++) {
                if (dataReferences[i].id.includes('simulate')) {
                    console.warn(`${req.originalUrl} Skipping deletion of simulate data: ${dataReferences[i].name}`);
                    continue;
                }
                try {
                    await deleteAssistantFile(dataReferences[i].id);
                } catch (error) {
                    console.warn(`Error deleting file ${dataReferences[i].id}:`, error);
                }
            }

            await deleteProjectData(email, SourceType.General, org, project, '', 'data_references');
        }

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send(`Invalid resource path`);
        }

        await deleteProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType);

        return res
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send(`Invalid resource path`);
        }

        const data = await getProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType);
        if (!data) {
            console.error(`Resource not found: ${source}, ${owner}, ${project}, ${decodedPath}, ${analysisType}`);
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Resource not found');
        }

        return res.status(HTTP_SUCCESS).contentType('text/plain').send(data);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.post(`${api_root_endpoint}/${files_source_owner_project_path_analysisType}`, async (req, res) => {

    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
        }

        const { source, owner, project, pathBase64, analysisType } = req.params;

        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            console.error('Missing required parameters in request:', req.params);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const data = req.body; // Assuming data is sent directly in the body
        if (!data) {
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('No data provided');
        }

        await storeProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType, data);
        res.sendStatus(HTTP_SUCCESS);

    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const proxy_ai_endpoint = "proxy/ai/:org/:endpoint";
const handleProxyRequest = async (req: Request, res: Response) => {
    logRequest(req);

    try {
        const org = req.params.org;
        const endpoint = req.params.endpoint;

        const email = await validateUser(req, res);
        if (!email) {
            return res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
        }

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
            timeout: secondsBeforeRestRequestMaximumTimeout * 1000
        };

        const startTimeOfCall = Date.now();
        try {
            const response = await axios(axiosOptions);
            const endTimeOfCall = Date.now();

            if (process.env.TRACE_LEVEL) {
                console.log(`${externalEndpoint} Proxy response: ${response.status} ${response.statusText} (${(endTimeOfCall - startTimeOfCall) / 1000} seconds)`);
            }

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
            return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
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
            return res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
        }

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`Missing signed identity - after User Validation passed`);
            return res
                .status(HTTP_FAILURE_UNAUTHORIZED)
                .send('Unauthorized');
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `proxy/ai/${org}/${Services.CustomerPortal}`, "GET");

        return res
            .status(HTTP_SUCCESS)
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
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        let newProfileData : UserProfile;
        try {
            newProfileData = JSON.parse(body) as UserProfile;
        } catch (error) {
            console.error(`Error parsing JSON: ${body}`, error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON Body');
        }

        const profileData: UserProfile = {};
        profileData.name = newProfileData.name;
        profileData.title = newProfileData.title;
        profileData.details = newProfileData.details;
        await storeProjectData(email, SourceType.General, 'user', '', '', 'profile', JSON.stringify(profileData));

        return res
            .status(HTTP_SUCCESS)
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
            .status(HTTP_SUCCESS)
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
            return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
        }
        const type = process.env.DEPLOYMENT_STAGE;
        if (!type) {
            console.error(`Missing DEPLOYMENT_STAGE environment variable`);
            return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
        }

        const status : ServiceStatusState = {
            version: version,
            status: 'available',
            type: type,
        };

        return res
            .status(HTTP_SUCCESS)
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
            .status(HTTP_SUCCESS)
            .contentType("text/plain")
            .send("Test HTTP GET Ack");
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

import { AuthType } from './auth';
import { log } from 'console';

const DefaultGroomingIntervalInMinutes = 5;

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
        const defaultInterval = DefaultGroomingIntervalInMinutes * 60;

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
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid Numberic Body');
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
            // if we're in AWS - and not running offline - then fail this call with a HTTP_FAILURE_BAD_REQUEST_INPUT
            console.error(`Timer API is not available in AWS`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Bad Request');
        }

        if (groomingInterval === -1) {

            // call the timing interval immediately/directly
            await callTimerAPI();

            return res
                .status(HTTP_SUCCESS)
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
            .status(HTTP_SUCCESS)
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
                .status(HTTP_FAILURE_UNAUTHORIZED)
                .send('Unauthorized');
        }

        try {
            // async launch of groom projects process (no "await")
            localSelfDispatch<void>("", originalIdentity, req, `groom/projects`, "POST");
        } catch (error) {
            console.error(`Timer Triggered: Error starting async groom projects process:`, error);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType("text/plain")
            .send(`Timer HTTP POST Ack: ${currentTimeinSeconds}`);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const user_org_connectors_openai_files = `user/:org/connectors/openai/files`;
app.get(`${api_root_endpoint}/${user_org_connectors_openai_files}`, async (req: Request, res: Response, next) => {
    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const org = req.params.org;
        if (!org) {
            console.error(`Org is required`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const project = typeof req.query.project === 'string' ? req.query.project : undefined;
        const dataType = typeof req.query.dataType === 'string' ? req.query.dataType : undefined;
        let repoUri = undefined;
        if (project) {
            const loadedProjectData = await loadProjectData(email, org, project) as UserProjectData | Response;
            if (!loadedProjectData) {
                console.warn(`${req.originalUrl} Project not found: ${org}/${project} - cannot filter on repos`);
            } else if ((loadedProjectData as UserProjectData)?.resources &&
                (loadedProjectData as UserProjectData).resources.length > 0) {
                repoUri = new URL((loadedProjectData as UserProjectData).resources[0].uri);
            }
        }

        const aiFiles : OpenAIFile[] = await searchOpenAIFiles(email, org, project, repoUri, dataType);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(aiFiles);
            
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const user_org_connectors_openai_assistants = `user/:org/connectors/openai/assistants`;
app.get(`${api_root_endpoint}/${user_org_connectors_openai_assistants}`, async (req: Request, res: Response, next) => {
    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const org = req.params.org;
        if (!org) {
            console.error(`Org is required`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const project = typeof req.query.project === 'string' ? req.query.project : undefined;

        const aiAssistants : OpenAIAssistant[] = await searchOpenAIAssistants(email, org, project);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(aiAssistants);
            
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

const user_org_connectors_openai_files_id = `user/:org/connectors/openai/files/:id`;
app.delete(`${api_root_endpoint}/${user_org_connectors_openai_files_id}`, async (req: Request, res: Response, next) => {
    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const org = req.params.org;
        if (!org) {
            console.error(`Org is required`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const fileId = req.params.id;
        if (!fileId) {
            console.error(`File Id is required`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }
        
        await deleteAssistantFile(fileId);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(fileId);
            
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_org_connectors_openai_files}`, async (req: Request, res: Response, next) => {
    logRequest(req);

    try {
        const email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const org = req.params.org;
        if (!org) {
            console.error(`Org is required`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const project : string | undefined = typeof req.query.project === 'string' ? req.query.project : undefined;
        const dataType : string | undefined = typeof req.query.dataType === 'string' ? req.query.dataType : undefined;
        let repoUri = undefined;
        if (project) {
            const loadedProjectData = await loadProjectData(email, org, project) as UserProjectData | Response;
            if (!loadedProjectData) {
                console.warn(`${req.originalUrl} Project not found: ${org}/${project} - cannot filter on repos`);
            } else if ((loadedProjectData as UserProjectData)?.resources &&
                (loadedProjectData as UserProjectData).resources.length > 0) {
                repoUri = new URL((loadedProjectData as UserProjectData).resources[0].uri);
            }
        }

        const shouldGroomInactiveFiles : boolean = req.query.groom != undefined;
        const liveReferencedDataFiles : Map<string, OpenAIFile> = new Map();

        const activeFileIdsInAssistants : string[] = [];
        const assistantFileSearchHandler = async (fileIds: string[]) => {
            for (const fileId of fileIds) {
                activeFileIdsInAssistants.push(fileId);
            }
        }

        // create a synchronous handler that will receive an OpenAIFile and check if it exists in liveReferenceDataFiles
        const shouldDeleteHandler = async (file: OpenAIFile) : Promise<boolean> => {
            if (!liveReferencedDataFiles.has(file.id)) {

                if (activeFileIdsInAssistants.includes(file.id)) {
                    console.warn(`Identified file ${file.filename}:${file.id} for grooming, but it is still in use`);
                    return false;
                }

                console.warn(`Identified file ${file.filename}:${file.id} for grooming`);
                return true;
            }

            if (!activeFileIdsInAssistants.includes(file.id)) {
                console.warn(`File ${file.filename}:${file.id} is reported to to be active, but not linked to any assistant`);
            }

            console.debug(`File ${file.filename}:${file.id} is still in use`);
            return false;
        }
        if (shouldGroomInactiveFiles) {

            await searchOpenAIAssistants(email, org, project, assistantFileSearchHandler);

            // Split the pathname by '/' and filter out empty strings
            const pathSegments = !repoUri?undefined:repoUri.pathname!.split('/').filter(segment => segment);

            // The relevant part is the last segment of the path
            const repoName = pathSegments?pathSegments.pop():undefined;
            const ownerName = pathSegments?pathSegments.pop():undefined;
            
            const rawDataReferences : any[] = await searchProjectData(email, SourceType.General, ownerName?ownerName:"*", project?project:"*", "", "data_references");
            if (rawDataReferences) {
                for (const rawReference in rawDataReferences) {
                    const dataReference = JSON.parse(rawReference) as ProjectDataReference;
                    liveReferencedDataFiles.set(dataReference.id,
                    {
                        id: dataReference.id,
                        object: "",
                        bytes: 0,
                        created_at: 0,
                        filename: dataReference.name,
                        purpose: ""
                    } as OpenAIFile);
                }
            }
        }

        const aiFiles : OpenAIFile[] = await deleteOpenAIFiles(email, org, project, repoUri, dataType, shouldGroomInactiveFiles?shouldDeleteHandler:undefined);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(aiFiles);
            
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

app.post("/test", (req: Request, res: Response, next) => {

    try {
        logRequest(req);

        const data = req.body;

        return res
            .status(HTTP_SUCCESS)
            .contentType("text/plain")
            .send(`Test HTTP POST Ack: ${data}`);
    } catch (error) {
        return handleErrorResponse(error, req, res);
    }
});

module.exports.handler = serverless(app);