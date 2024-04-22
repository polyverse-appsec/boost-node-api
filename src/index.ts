import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';

import { AuthType } from './auth';
import { getUser, saveUser } from './account';

import serverless from 'serverless-http';
import {
    getProjectData,
    searchProjectData,
    storeProjectData,
    SourceType,
    convertToSourceType,
    deleteProjectData,
    searchWildcard,
    getCachedProjectData,
    splitAndStoreData,
} from './storage';
import {
    validateUser,
    signedAuthHeader,
    getSignedIdentityFromHeader,
    local_sys_admin_email,
    header_X_Signed_Identity } from './auth';
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
    OpenAIAssistant,
    deleteOpenAIAssistant,
    getOpenAIFile,
    getOpenAIAssistant
} from './openai';
import { UserProjectData } from './types/UserProjectData';
import { DiscoveryTrigger } from './types/DiscoveryTrigger';
import { GeneratorState, TaskStatus, Stages } from './types/GeneratorState';
import { ProjectStatusState } from './types/ProjectStatusState';
import { ProjectStatus } from './types/ProjectStatus';
import { ProjectAssistantInfo } from './types/ProjectAssistantInfo';

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
    HTTP_CONFLICT,
    HTTP_SUCCESS_ACCEPTED,
    HTTP_SUCCESS_NO_CONTENT,
    HTTP_LOCKED,
    HTTP_FAILURE_SERVICE_UNAVAILABLE,
    millisecondsBeforeRestRequestMicroTimeout,
} from './utility/dispatch';

import { usFormatter } from './utility/log';
import { getCurrentVersion } from './utility/version';
import { DiscoverState } from './types/DiscoverState';
import { ProjectGoals } from './types/ProjectGoals';

export const app = express();

export const mbLimitForJSON = 10
export const mbLimitForText = 10

app.use(express.json({ limit: `${mbLimitForJSON}mb` }));
app.use(express.text({ limit: `${mbLimitForText}mb` }));

/*
// Error handling middleware
app.use((err : any, req : Request, res : Response) => {
    console.error(`${email} ${req.method} ${req.originalUrl} Request ${req} failed with error ${err}`);
    res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
});
*/

// for debugging only
if (process.env.IS_OFFLINE) {
//    process.env.SIMULATE_OPENAI_UPLOAD = 'true';
//    process.env.ONE_AI_SPEC = 'true';
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
    return await getCachedProjectData<string>(email, SourceType.GitHub, ownerName, repoName, path, resource);
}

const postOrPutUserProjectDataResource = async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl} Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl} Project is required`);
            }

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project);
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
            console.error(`${email} ${req.method} ${req.originalUrl} : empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        const { _, __, resource } = req.params;

        await saveProjectDataResource(email, ownerName, repoName, resource, '', body);

        const resourceStatus : ResourceStatusState = {
            lastUpdated: Math.floor(Date.now() / 1000)
        }            

        await storeProjectData(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status", resourceStatus);

        console.debug(`${email} ${req.method} ${req.originalUrl} Saved Resource ${resource}:${body.length} bytes`);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(resourceStatus);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
};

async function loadProjectData(email: string, org: string, project: string): Promise<UserProjectData | undefined> {
    let projectDataRaw = await getProjectData(email, SourceType.General, org, project, '', 'project');
    if (!projectDataRaw) {
        if (process.env.TRACE_LEVEL) {
            console.warn(`${email} ${org} ${project} loadProjectData: not found`);
        }
        return undefined;
    }

    const projectData = JSON.parse(projectDataRaw) as UserProjectData;
    // create an object with the string fields, org, name, guidelines, array of string resources
    const userProjectData : UserProjectData = {
        ...projectData,
        org : org,
        name : project,
        resources : projectData.resources? projectData.resources : [],
        lastUpdated : projectData.lastUpdated? projectData.lastUpdated : Date.now() / 1000,
    };

    // repair steps for guidelines
    if (typeof projectData.guidelines === 'string' && projectData.guidelines !== '') {
        const newGuidelineRecord : Record<string, string> = {};
        newGuidelineRecord['default'] = projectData.guidelines;
        userProjectData.guidelines = [newGuidelineRecord];
    } else if (!projectData.guidelines || (projectData as any).guidelines === '') {
        userProjectData.guidelines = [];
    }

    return projectData;
}

function checkPrivateAccessAllowed(accountStatus: UserAccountState): boolean {
    return accountStatus.enabled && accountStatus.plan === 'premium';
}

const user_org_connectors_github_file = `user/:org/connectors/github/file`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_file}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            if (!req.query.repo && !req.query.path) {
                console.error(`${email} ${req.method} ${req.originalUrl} URI is required`);
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
                    console.error(`${email} ${req.method} ${req.originalUrl} Invalid encoded URI: ${uriString}`);
                    return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid encoded URI');
                }
            }

            try {
                uri = new URL(uriString as string);
            } catch (error) {
                console.error(`${email} ${req.method} ${req.originalUrl} Invalid URI: ${uriString}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid URI');
            }
        } else if (repoString && pathString) {
            if (repoString.match(/%[0-9a-f]{2}/i)) {
                try {
                    repoString = decodeURIComponent(repoString);
                } catch (error) {
                    return handleErrorResponse(email, error, req, res, `Invalid encoded repo: ${repoString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
                }
            }
            try {
                repo = new URL(repoString as string);
            } catch (error) {
                return handleErrorResponse(email, error, req, res, `Invalid repo: ${repoString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            if (pathString.match(/%[0-9a-f]{2}/i)) {
                try {
                    path = decodeURIComponent(pathString);
                } catch (error) {
                    return handleErrorResponse(email, error, req, res, `Invalid encoded path: ${pathString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
                }
            } else {
                path = pathString;
            }
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            return handleErrorResponse(email, new Error("Unauthorized"), req, res, `Missing signed identity - after User Validation passed`, HTTP_FAILURE_UNAUTHORIZED);
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFileFromRepo(email, uri!, repo!, path, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }

});

const user_org_connectors_github_folders = `user/:org/connectors/github/folders`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_folders}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            return handleErrorResponse(email, new Error("URI is required"), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                return handleErrorResponse(email, error, req, res, `Invalid encoded URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            return handleErrorResponse(email, error, req, res, `Invalid URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            return handleErrorResponse(email, new Error("Unauthorized"), req, res, `Missing signed identity - after User Validation passed`, HTTP_FAILURE_UNAUTHORIZED);
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFolderPathsFromRepo(email, uri, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_org_connectors_github_files = `user/:org/connectors/github/files`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_files}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            return handleErrorResponse(email, new Error("URI is required"), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                return handleErrorResponse(email, error, req, res, `Invalid encoded URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            return handleErrorResponse(email, error, req, res, `Invalid URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            return handleErrorResponse(email, new Error("Unauthorized"), req, res, `Missing signed identity - after User Validation passed`, HTTP_FAILURE_UNAUTHORIZED);
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFilePathsFromRepo(email, uri, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_org_connectors_github_fullsource = `user/:org/connectors/github/fullsource`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_fullsource}`,
    express.text({ limit: '10mb' }),
    express.json({ limit: '10mb' }),

    async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            return handleErrorResponse(email, new Error("URI is required"), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                return handleErrorResponse(email, error, req, res, `Invalid encoded URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            return handleErrorResponse(email, error, req, res, `Invalid URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const { org } = req.params;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            return handleErrorResponse(email, new Error("Unauthorized"), req, res, `Missing signed identity - after User Validation passed`, HTTP_FAILURE_UNAUTHORIZED);
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');
        const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

        return getFullSourceFromRepo(email, uri, req, res, privateAccessAllowed);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_org_connectors_github_permission = `user/:org/connectors/github/access`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_permission}`,
    async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            return handleErrorResponse(email, new Error("URI is required"), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let uriString = req.query.uri as string;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                return handleErrorResponse(email, error, req, res, `Invalid encoded URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
        }

        let uri;
        try {
            uri = new URL(uriString as string);
        } catch (error) {
            return handleErrorResponse(email, error, req, res, `Invalid URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        // check if this user has access to this private repo
        const accessGranted : boolean = await verifyUserAccessToPrivateRepo(email, uri);

        res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(accessGranted);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_org_connectors_github_details = `user/:org/connectors/github/details`;
app.get(`${api_root_endpoint}/${user_org_connectors_github_details}`,
    async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!req.query.uri) {
            return handleErrorResponse(email, new Error("URI is required"), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let uriString = req.query.uri as string;
        const { org } = req.params;

        // Check if the URI is encoded, decode it if necessary
        if (uriString.match(/%[0-9a-f]{2}/i)) {
            try {
                uriString = decodeURIComponent(uriString);
            } catch (error) {
                return handleErrorResponse(email, error, req, res, `Invalid encoded URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
        }

        let resourceUri;
        try {
            resourceUri = new URL(uriString as string);
        } catch (error) {
            return handleErrorResponse(email, error, req, res, `Invalid URI: ${uriString}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        // get the account status
        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            return handleErrorResponse(email, 
                new Error("Unauthorized"), req, res, `Missing signed identity - after User Validation passed`, HTTP_FAILURE_UNAUTHORIZED);
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');

        // verify this account (and org pair) can access this resource
        const allowPrivateAccess = checkPrivateAccessAllowed(accountStatus);
        const repoDetails : RepoDetails = await getDetailsFromRepo(email, resourceUri, req, res, allowPrivateAccess);

        res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(repoDetails);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

async function validateProjectRepositories(email: string, org: string, resources: ProjectResource[], req: Request, res: Response) : Promise<Response | undefined> {

    // validate every resource is a valid Uri
    for (const resource of resources) {
        if (!resource.uri) {
            return handleErrorResponse(email, new Error("Resource Uri is required"), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }
        let resourceUri;
        try {
            resourceUri = new URL(resource.uri);
        } catch (error) {
            return handleErrorResponse(email, new Error(`Invalid URI: ${resource.uri}`), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        // for now, we'll validate that the resource is a valid GitHub resource
        //      and we can access it with this user account plan
        // Split the hostname by '.' and check the last two parts
        const hostnameParts = resourceUri.hostname.toLowerCase().split('.');
        const topLevelDomain = hostnameParts[hostnameParts.length - 1];
        const secondLevelDomain = hostnameParts[hostnameParts.length - 2];

        // Validate that the resource is from github.com
        if (!(secondLevelDomain === 'github' && topLevelDomain === 'com')) {
            return handleErrorResponse(email, new Error("Invalid Resource - must be Github"), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }
        // get the account status
        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            return handleErrorResponse(email, 
                new Error("Unauthorized"), req, res, `Missing signed identity - after User Validation passed`, HTTP_FAILURE_UNAUTHORIZED);
        }
        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `user/${org}/account`, 'GET');

        // verify this account (and org pair) can access this resource
        const allowPrivateAccess = checkPrivateAccessAllowed(accountStatus);
        const repoDetails : RepoDetails = await getDetailsFromRepo(email, resourceUri, req, res, allowPrivateAccess);

        if (repoDetails.errorResponse) {
            return repoDetails.errorResponse;
        } else if (!repoDetails.data) {
            return handleErrorResponse(email, new Error(`Unable to get Repo Details and no Error found: ${resource.uri}`), req, res);
        }
    }
    return undefined;
}

const user_project_org_projects = `user_project/:org/projects`;
app.get(`${api_root_endpoint}/${user_project_org_projects}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org } = req.params;

        if (!org) {
            return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        // we're going to make a call to the ${search_projects} endpoint to get the list of projects
        //      passing the email and org as query params to the endpoint
        // But since this is a system wide search, we need to elevate to admin to get the list of projects
        const encodedEmail = encodeURIComponent(email);
        const localAdminAuthHeader = await signedAuthHeader(local_sys_admin_email);
        const projectsFound = await localSelfDispatch<UserProjectData[]>(
            email, localAdminAuthHeader[header_X_Signed_Identity], req, `${search_projects}?user=${encodedEmail}&org=${org}`, 'GET');

        if (process.env.TRACE_LEVEL) {
            console.debug(`ProjectSearch: Found ${projectsFound.length} projects for ${org}:${email}`);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(projectsFound);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_project_org_project = `user_project/:org/:project`;
app.patch(`${api_root_endpoint}/${user_project_org_project}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let body = req.body;

        if (!body) {
            console.error(`${email} ${req.method} ${req.originalUrl} empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        if (typeof body !== 'string') {
            if (Buffer.isBuffer(body) || Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            } else {
                body = JSON.stringify(body);
            }
        }

        if (body === undefined || body === '') {
            console.error(`${email} ${req.method} ${req.originalUrl} empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }
        try {
            body = JSON.parse(body) as UserProjectData;
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack || error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON: ' + JSON.stringify(body));
        }
        if (Object.keys(body).length === 0) {
            console.error(`${email} ${req.method} ${req.originalUrl} empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        let discoveryRequired : boolean = false;

        // Puts resources and/or guideline values to be updated into new object    
        let updates: { resources?: ProjectResource[], guidelines?: Record<string, string> } = {};
        if (body.resources !== undefined) {
            updates.resources = body.resources;

            if (await validateProjectRepositories(email, org, body.resources, req, res)) {
                return res;
            }
            discoveryRequired = true;
        }
        if (body.title !== undefined && (body.title === '' || typeof body.title !== 'string')) {
            return handleErrorResponse(email, new Error(`Invalid id: ${body.title}`), req, res, `Invalid id ${body.title} - must be a non-empty string`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }
        if (body.description !== undefined && typeof body.description !== 'string') {
            return handleErrorResponse(email, new Error(`Invalid description: ${body.description}`), req, res, `Invalid description ${body.description} - must be a string`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        if (body.guidelines !== undefined) {
            if (typeof body.guidelines === 'string') {
                return handleErrorResponse(email, new Error(`Invalid guidelines: ${body.guidelines}`), req, res, `Invalid guidelines - cannot be a string`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            // must be an array of Record<string, string>
            else if (!Array.isArray(body.guidelines)) {
                return handleErrorResponse(email, new Error(`Invalid guidelines: ${body.guidelines}`), req, res, `Invalid guidelines - must be an array`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            updates.guidelines = body.guidelines;
            discoveryRequired = true;
        }
    
        const projectData = await loadProjectData(email, org, project);
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }
        Object.assign(projectData, updates);

        projectData.lastUpdated = Date.now() / 1000;

        await storeProjectData(email, SourceType.General, org, project, '', 'project', projectData);

        // only launch discovery if we actually updated the resources or guidelines
        if (discoveryRequired) {
            const signedIdentity = (await signedAuthHeader(email))[header_X_Signed_Identity];

            // get the path of the project data uri - excluding the api root endpoint
            const projectDataPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
            const discoveryWithResetState : DiscoverState = {
                resetResources: true,
                requestor: DiscoveryTrigger.ProjectUpdate
            };

            try {
                await localSelfDispatch<void>(email, signedIdentity, req, `${projectDataPath}/discovery`, 'POST', discoveryWithResetState);
            } catch (error) {
                console.error(`${email} ${req.method} ${req.originalUrl} Unable to launch discovery for ${projectDataPath}`, error);
            }
        }

        return res
            .status(HTTP_SUCCESS)
            .send();
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const postOrPutUserProject = async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
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

        if (body === '' || body === undefined) {
            console.error(`${email} ${req.method} ${req.originalUrl} empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }


        // Parse the body string to an object
        let updatedProject;
        try {
            updatedProject = JSON.parse(body);
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack || error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON');
        }

        const storedProject : UserProjectData = {
            org : org,
            name : project,
            title : updatedProject.title? updatedProject.title : '',
            description : updatedProject.description? updatedProject.description : '',
            guidelines : updatedProject.guidelines? updatedProject.guidelines : [],
            resources : updatedProject.resources? updatedProject.resources : [],
            lastUpdated : Date.now() / 1000,
        };

        // validate title
        if (body.title !== undefined && (body.title === '' || typeof body.title !== 'string')) {
            console.error(`${email} ${req.method} ${req.originalUrl} Invalid id: ${body.title}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send(`Invalid id ${body.title} - must be a non-empty string`);
        } else if (body.title !== undefined) {
            storedProject.title = updatedProject.title;
        }

        // validate description
        if (body.description !== undefined && typeof body.description !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} Invalid description: ${body.description}`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send(`Invalid description ${body.description} - must be a string`);
        } else if (body.description !== undefined) {
            storedProject.description = updatedProject.description;
        }

        // validate guidelines
        if (storedProject.guidelines !== undefined) {
            if (typeof storedProject.guidelines === 'string') {
                console.error(`${email} ${req.method} ${req.originalUrl} Invalid guidelines: ${storedProject.guidelines}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid guidelines - cannot be a string');
            }
            // must be an array of Record<string, string>
            else if (!Array.isArray(storedProject.guidelines)) {
                console.error(`${email} ${req.method} ${req.originalUrl} Invalid guidelines: ${storedProject.guidelines}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid guidelines - must be an array');
            }
        }

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
            if (!(error.message.includes('failed with status') && error.message.includes('404'))) {
                console.error(`${email} ${req.method} ${req.originalUrl} Unable to retrieve current project data just post the new data - due to error: `, error.stack || error);
            }
        }

        // validate this user has access to these repositories
        if (await validateProjectRepositories(email, org, storedProject.resources, req, res)) {
            return res;
        }

        // refresh the project updated time - since we've finished validation
        storedProject.lastUpdated = Date.now() / 1000;

        await storeProjectData(email, SourceType.General, org, project, '', 'project', storedProject);

        // we're going to initialize an async project status refresh (but only wait a few milliseconds to make sure it starts)
        try {
            await localSelfDispatch<ProjectStatusState>(
                email, "", req,
                `${projectPath}/status`, 'POST', undefined, millisecondsBeforeRestRequestMicroTimeout, false);
        } catch (error: any) {
            // we don't care if the project status refresh fails - it's just a nice to have
            console.warn(`${email} ${req.method} ${req.originalUrl} Unable to initialize the project status: `, error.stack || error);
        }

        // because the discovery process may take more than 15 seconds, we never want to fail the project creation
        //      no matter how long discovery takes or even if discovery runs
        // so we'll use the axios timeout to ensure we don't wait too long for the discovery process
        const maximumDiscoveryTimeoutOnProjectCreationInSeconds = 15;

        const discoveryWithResetState : DiscoverState = {
            resetResources: true,
            requestor: DiscoveryTrigger.ProjectUpdate
        };

        try {
            await localSelfDispatch<void>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, `${projectPath}/discovery`, 'POST',
                discoveryWithResetState, maximumDiscoveryTimeoutOnProjectCreationInSeconds * 1000);

            // if the new task stage completes in 1 seconds, we'll wait...
            console.log(`${email} ${req.method} ${req.originalUrl} TIMECHECK: discovery completed in ${maximumDiscoveryTimeoutOnProjectCreationInSeconds} seconds`);
        } catch (error: any) {
            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                console.log(`${email} ${req.method} ${req.originalUrl} TIMECHECK: TIMEOUT: discovery timed out after ${maximumDiscoveryTimeoutOnProjectCreationInSeconds} seconds`);
            } else {
                // This block is for handling errors, including HTTP_FAILURE_NOT_FOUND and HTTP_FAILURE_INTERNAL_SERVER_ERROR status codes
                if (axios.isAxiosError(error) && error.response) {
                    const errorMessage = error.message;
                    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';
                    console.log(`${email} ${req.method} ${req.originalUrl} TIMECHECK: discovery failed ${error.response.status}:${error.response.data} - due to error: ${errorMessage} - ${errorDetails}`);
                } else if (error.code !== undefined) {
                    console.log(`${email} ${req.method} ${req.originalUrl} TIMECHECK: discovery failed ${error.code} - due to error: ${error}`);
                } else {
                    // Handle other errors (e.g., network errors)
                    console.log(`${email} ${req.method} ${req.originalUrl} TIMECHECK: discovery failed due to error: ${error}`);
                }
            }
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(storedProject);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
}

// route for both project PUT and POST
app.route(`${api_root_endpoint}/${user_project_org_project}`)
    .post(postOrPutUserProject)
    .put(postOrPutUserProject);

app.get(`${api_root_endpoint}/${user_project_org_project}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const projectData = await loadProjectData(email, org, project);
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
        return handleErrorResponse(email, error, req, res);
    }
    
});

app.delete(`${api_root_endpoint}/${user_project_org_project}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const projectPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));

        try { // delete the data_references as well
            await localSelfDispatch<void>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, `${projectPath}/data_references`, 'DELETE');
        } catch (error: any) { // ignore 404 errors
            if (!error.code || error.code !== HTTP_FAILURE_NOT_FOUND.toString()) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Unable to delete data references due to error: `, error.stack || error);
            }
        }

        try { // delete the discover status as well
            await localSelfDispatch<void>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, `${projectPath}/discover`, 'DELETE');
        } catch (error: any) { // ignore 404 errors
            if (!error.code || error.code !== HTTP_FAILURE_NOT_FOUND.toString()) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Unable to delete discovery status due to error: `, error.stack || error);
            }
        }

        try { // delete the project status as well
            await localSelfDispatch<void>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, `${projectPath}/status`, 'DELETE');
        } catch (error: any) { // ignore 404 errors
            if (!error.code || error.code !== HTTP_FAILURE_NOT_FOUND.toString()) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Unable to delete project status due to error: `, error.stack || error);
            }
        }

        // delete all data resources
        const possibleResources = [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification];
        for (const resourceType of possibleResources) {
            try {
                await localSelfDispatch<void>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, `${projectPath}/data/${resourceType}`, 'DELETE');
            } catch (error: any) { // ignore 404 errors
                if (!error.code || error.code !== HTTP_FAILURE_NOT_FOUND.toString()) {
                    console.warn(`${email} ${req.method} ${req.originalUrl} Unable to delete resource ${resourceType} due to error: `, error.stack || error);
                }
            }
        }

        // delete the grooming state
        try {
            await localSelfDispatch<void>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, `${projectPath}/groom`, 'DELETE');
        } catch (error: any) { // ignore 404 errors
            if (!error.code || error.code !== HTTP_FAILURE_NOT_FOUND.toString()) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Unable to delete grooming data due to error: `, error.stack || error);
            }
        }

        // we delete project at end - to avoid the above sub-resources from getting leaked by their owner being deleted
        await deleteProjectData(email, SourceType.General, org, project, '', 'project');

        return res
            .status(HTTP_SUCCESS)
            .send();
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
    
});

// Services to search the entire system for any project
const search_projects = `search/projects`;
app.get(`${api_root_endpoint}/${search_projects}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        // since project search is system wide by default, we're going to require admin access to
        //      run a search
        email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        // query params support:
        //  - org?: string - specific org, or all if not specified
        //  - project?: string - specific project, or all if not specified
        //  - user?: string - a specific user, or all if not specified

        const { org, project, user } = req.query;
        if (org && typeof org !== 'string') {
            return handleErrorResponse(email, new Error("Org must be a string"), req, res, "Invalid org", HTTP_FAILURE_BAD_REQUEST_INPUT);
        } else if (project && typeof project !== 'string') {
            return handleErrorResponse(email, new Error("Project must be a string"), req, res, "Invalid project", HTTP_FAILURE_BAD_REQUEST_INPUT);
        } else if (user && typeof user !== 'string') {
            return handleErrorResponse(email, new Error("User must be a string"), req, res, "Invalid user", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const projectDataList : UserProjectData[] = await searchProjectData<UserProjectData>(user?user as string:searchWildcard, SourceType.General, org?org as string:searchWildcard, project?project as string:searchWildcard, "", 'project');

        if (process.env.TRACE_LEVEL) {
            console.log(`${email} ${req.method} ${req.originalUrl} : retrieved data for ${projectDataList.length} raw project data`);
        }

        for (const projectData of projectDataList) {
            // the project owner is the first part of the project data path, up until the first '/'
            projectData.owner = (projectData as any)._userName;
            delete (projectData as any)._userName;
            delete (projectData as any)._ownerName;
            delete (projectData as any)._projectName;

            // repair the guidelines if needed
            if (projectData.guidelines !== undefined) {
                if (typeof projectData.guidelines === 'string') {
                    if (projectData.guidelines !== '') {
                        const newGuidelineRecord : Record<string, string> = {
                            'default' : projectData.guidelines
                        };
                        console.warn(`${email} ${req.method} ${req.originalUrl} Repaired guidelines: from: ${projectData.guidelines} to: ${newGuidelineRecord}`);
                        projectData.guidelines = [newGuidelineRecord];
                    } else {
                        projectData.guidelines = [];
                    }
                }
                // must be an array of Record<string, string>
                else if (!Array.isArray(projectData.guidelines)) {
                    console.error(`${email} ${req.method} ${req.originalUrl} Invalid guidelines - resetting to empty: ${projectData.guidelines}`);
                    projectData.guidelines = [];
                }
            }
        }

        if (process.env.TRACE_LEVEL) {
            console.log(`${email} ${req.method} ${req.originalUrl}  retrieved data for ${projectDataList.length} projects`);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(projectDataList);

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

interface ProjectSearchData {
    org: string;
    project: string;
    user: string;
    data: any;
}

// Services to search the entire system for any grooming of projects
const search_projects_groom = `search/projects/groom`;
app.get(`${api_root_endpoint}/${search_projects_groom}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        // since project search is system wide by default, we're going to require admin access to
        //      run a search
        email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        // query params support:
        //  - org?: string - specific org, or all if not specified
        //  - project?: string - specific project, or all if not specified
        //  - user?: string - a specific user, or all if not specified
        //  - status?: string - a specific Grooming status, or all if not specified

        const { org, project, user, status } = req.query;
        if (org && typeof org !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} Org must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid org');
        } else if (project && typeof project !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} Project must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid project');
        } else if (user && typeof user !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} User must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid user');
        } else if (status && typeof status !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} Status must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid status');
        }

        const groomingDataList : ProjectGroomState[] =
            await searchProjectData<ProjectGroomState>(
            user?user as string:searchWildcard, SourceType.General,
            org?org as string:searchWildcard,
            project?project as string:searchWildcard, "", 'groom');

        cleanupProjectDataSearchResults(groomingDataList);

        if (process.env.TRACE_LEVEL) {
            console.log(`${email} ${req.method} ${req.originalUrl} retrieved data for ${groomingDataList.length} raw groom data`);
        }

        const groomingDataListFilteredByStatus : ProjectGroomState[] =
            groomingDataList.filter((groomData) => status?groomData.status === status:true);

        const listOfProjectNames : string = groomingDataListFilteredByStatus.map((groomData) => `${(groomData as any).owner} org=${(groomData as any).org} project=${(groomData as any).project}`).join('\n');
        console.info(`${email} ${req.method} ${req.originalUrl}  retrieved ${groomingDataListFilteredByStatus.length} Projects to Groom with status:${status?status:'all'}: ${listOfProjectNames}`);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(groomingDataListFilteredByStatus);

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

function cleanupProjectDataSearchResults(projectSearchData: any[]) {
    // we need to remove the _userName, _ownerName, and _projectName from the data, and replace them
    //   with the owner, org, and project values
    for (const searchItem of projectSearchData) {
        (searchItem as any).owner = (searchItem as any)._userName;
        (searchItem as any).org = (searchItem as any)._ownerName;
        (searchItem as any).project = (searchItem as any)._projectName;
        delete (searchItem as any)._userName;
        delete (searchItem as any)._ownerName;
        delete (searchItem as any)._projectName;
    }
}

// Services to search the entire system for the status of all projects
const search_projects_status = `search/projects/status`;
app.get(`${api_root_endpoint}/${search_projects_status}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        // since project search is system wide by default, we're going to require admin access to
        //      run a search
        email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        // query params support:
        //  - org?: string - specific org, or all if not specified
        //  - project?: string - specific project, or all if not specified
        //  - user?: string - a specific user, or all if not specified
        //  - synchronized?: string - a specific project status, or all if not specified

        const { org, project, user, synchronized } = req.query;
        if (org && typeof org !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} Org must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid org');
        } else if (project && typeof project !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} Project must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid project');
        } else if (user && typeof user !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} User must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid user');
        } else if (synchronized && typeof synchronized !== 'string') {
            console.error(`${email} ${req.method} ${req.originalUrl} synchronized must be a string`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid synchronized');
        }

        const statusDataList : ProjectStatusState[] =
            await searchProjectData<ProjectStatusState>(
            user?user as string:searchWildcard, SourceType.General,
            org?org as string:searchWildcard,
            project?project as string:searchWildcard, "", 'status');

        cleanupProjectDataSearchResults(statusDataList);

        if (process.env.TRACE_LEVEL) {
            console.log(`${email} ${req.method} ${req.originalUrl} retrieved data for ${statusDataList.length} raw status data`);
        }

        const synchronizedMatch = synchronized === 'true'?true:synchronized === 'false'?false:undefined;

        const statusDataListFilteredBySynchronized : ProjectStatusState[] =
            statusDataList.filter((statusData) => (synchronizedMatch !== undefined)?statusData.synchronized === synchronizedMatch:true);

        const listOfProjectNames : string = statusDataListFilteredBySynchronized.map((statusData) => `${(statusData as any).owner} org=${(statusData as any).org} project=${(statusData as any).project}`).join('\n');
        console.info(`${email} ${req.method} ${req.originalUrl} retrieved ${statusDataListFilteredBySynchronized.length} Project Status with synchronized:${synchronizedMatch?synchronizedMatch:'all'}: ${listOfProjectNames}`);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(statusDataListFilteredBySynchronized);

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

// Services to search the entire system for any grooming of projects
const search_projects_generators_groom = `search/projects/generators`;
app.get(`${api_root_endpoint}/${search_projects_generators_groom}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        // since project search is system wide by default, we're going to require admin access to
        //      run a search
        email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        // query params support:
        //  - org?: string - specific org, or all if not specified
        //  - project?: string - specific project, or all if not specified
        //  - user?: string - a specific user, or all if not specified
        //  - resourceType?: string - a specific resource type, or all if not specified

        const { org, project, user, resource, status } = req.query;
        if (org && typeof org !== 'string') {
            return handleErrorResponse(email, new Error("Org must be a string"), req, res, "Invalid org", HTTP_FAILURE_BAD_REQUEST_INPUT);
        } else if (project && typeof project !== 'string') {
            return handleErrorResponse(email, new Error("Project must be a string"), req, res, "Invalid project", HTTP_FAILURE_BAD_REQUEST_INPUT);
        } else if (user && typeof user !== 'string') {
            return handleErrorResponse(email, new Error("User must be a string"), req, res, "Invalid user", HTTP_FAILURE_BAD_REQUEST_INPUT);
        } else if (resource && typeof resource !== 'string') {
            return handleErrorResponse(email, new Error("Resource must be a string"), req, res, "Invalid resource", HTTP_FAILURE_BAD_REQUEST_INPUT);
        } else if (status && typeof status !== 'string') {
            return handleErrorResponse(email, new Error("Status must be a string"), req, res, "Invalid status", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const generatorDataList : GeneratorState[] =
            await searchProjectData<GeneratorState>(
            user?user as string:searchWildcard, SourceType.GitHub,
            org?org as string:searchWildcard,
            project?project as string:searchWildcard,
            resource?`/${resource as string}`:searchWildcard,
            'generator');

        console.info(`${email} ${req.method} ${req.originalUrl}  retrieved ${generatorDataList.length} Generators`);

        const generatorDataListFilteredByStatus : GeneratorState[] =
            generatorDataList.filter((generatorData) => status?generatorData.status === status:true);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(generatorDataListFilteredByStatus);

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

interface GroomProjectsState {
    projectsToGroom: UserProjectData[]
}

// to make this more efficient - it could store the state (instead of pipelining the data in a call chain)
//      in which case the groomer interval could be shorter, knowing it would only take a smaller slice
// Currently, the grooming interval needs to be large enough to groom all projects once, but not shorter
//      since it could cause overlapping grooming cycles (not destructive, but wasteful)
const groom_projects = `groom/projects`;
app.post(`${api_root_endpoint}/${groom_projects}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        // need to elevate to admin since we search all projects for grooming action
        email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        const originalIdentityHeader = getSignedIdentityFromHeader(req);
        if (!originalIdentityHeader) {
            console.error(`${email} ${req.method} ${req.originalUrl} Unauthorized: Signed Header missing`);
            return res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
        }

        let body = req.body;
        let projectsToGroom : UserProjectData[] = [];
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
            if (body !== '') {
                try {
                    const groomProjectsState : GroomProjectsState = JSON.parse(body);
                    // if we encounter a JSON error here, we'll return a bad input error
                    // for everything else, we'll throw the error
                    
                    projectsToGroom = groomProjectsState.projectsToGroom;
                } catch (parseError: any) {
                    if (parseError instanceof SyntaxError) {
                        console.error(`${email} ${req.method} ${req.originalUrl} Invalid JSON: ${parseError.stack || parseError}`);
                        return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send(`Invalid JSON in body - ${parseError.stack || parseError}`);
                    } else {
                        throw parseError;
                    }
                }
            }
        }

        if (!projectsToGroom || projectsToGroom.length === 0) {
            // get all the projects
            const projects : UserProjectData[] =
                await localSelfDispatch<UserProjectData[]>(email, originalIdentityHeader, req, search_projects, 'GET');

                // we'll look for projects with resources, and then make sure they are up to date
            const projectsWithResources = projects.filter(project => project.resources.length > 0);

            projectsToGroom = projectsWithResources;
        }

        function shuffleArray(array: any) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]]; // Swap elements
            }
        }
        shuffleArray(projectsToGroom);

        // Take the first 25 projects after shuffling, or fewer if there aren't 25 projects
        const selectedProjects = projectsToGroom.slice(0, Math.min(25, projectsToGroom.length));

        const millisecondsToLaunchGrooming = 200;

        // for each project, we'll check the status of the resources
        // Transform each project into a promise of grooming state or error
        const groomingPromises = selectedProjects.map(project => {
            const projectDataPath = user_project_org_project.replace(":org", project.org).replace(":project", project.name);

            if (!project.owner) {
                console.error(`${email} ${req.method} ${req.originalUrl} Unable to groom; Project ${projectDataPath} has no owner`);
                return Promise.resolve(null); // Resolve to null to easily filter out later
            }

            return (async () => {
                const thisProjectIdentityHeader = (await signedAuthHeader(project.owner!))[header_X_Signed_Identity];
                try {
                    const groomingState: ProjectGroomState = await localSelfDispatch<ProjectGroomState>(
                        project.owner!, thisProjectIdentityHeader, req, `${projectDataPath}/groom`, 'POST',
                        undefined, millisecondsToLaunchGrooming, false);

                    if (groomingState?.status === undefined) {
                        if (process.env.TRACE_LEVEL) {
                            console.warn(`${email} ${req.method} ${req.originalUrl} Timeout starting Project ${projectDataPath} grooming; unclear result`);
                        }
                        return { project, groomingState: undefined };
                    } else if (groomingState.status === GroomingStatus.Grooming) {
                        // grooming in progress
                    } else {
                        if (process.env.TRACE_LEVEL) {
                            console.log(`${email} ${req.method} ${req.originalUrl} Project ${projectDataPath} is not grooming - status: ${groomingState.status}`);
                        }
                    }

                    return { project, groomingState };

                } catch (error: any) {
                    switch (error?.response?.status) {
                    case HTTP_FAILURE_NOT_FOUND:
                        if (process.env.TRACE_LEVEL) {
                            console.log(`${email} ${req.method} ${req.originalUrl} Project ${projectDataPath} not found`);
                        }
                        break;
                    case HTTP_LOCKED:
                        if (process.env.TRACE_LEVEL) {
                            console.warn(`${email} ${req.method} ${req.originalUrl} Project  ${projectDataPath} Groomer is busy`);
                        }
                        break;
                    default:
                        if (axios.isAxiosError(error) && error.response) {
                            const errorMessage = error.message;
                            const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';
                            console.error(`${email} ${req.method} ${req.originalUrl} Unable to launch async grooming for ${projectDataPath} - due to error: ${error.response.status}:${errorMessage} - ${errorDetails}`);
                        } else {
                            console.error(`${email} ${req.method} ${req.originalUrl} Unable to launch async grooming for ${projectDataPath}`, (error.stack || error));
                        }
                        break;
                    }

                    return null; // Return null to filter out failed or skipped projects
                }
            })();
        });

        // Wait for all grooming operations to complete
        const results = await Promise.all(groomingPromises);
        
        const projectsGroomed : UserProjectData[] = []; // projects we successfully started grooming
        const projectsForRetry : UserProjectData[] = []; // projects we errored trying to groom

        // Filter and extract successfully groomed projects
        results.forEach(result => {
            if (!result) {
                return;
            }
            if (result.groomingState) {
                projectsGroomed.push(result.project);
            } else {
                projectsGroomed.push(result.project);
            }
        });

        // get the remainder of the projects to groom - minus the first 25 sliced off

        const nextBatch = projectsForRetry.concat(projectsToGroom.slice(25));

        console.info(`${email} ${req.method} ${req.originalUrl} Groomed ${projectsGroomed.length} projects; ${nextBatch.length} projects remaining`);

        if (nextBatch.length > 0) {
            const groomProjectsState : GroomProjectsState = {
                projectsToGroom: nextBatch
            };
            try {
                const result = await localSelfDispatch<UserProjectData[]>(email, "", req, groom_projects, 'POST', groomProjectsState, millisecondsToLaunchGrooming, false);
                if (result?.length === undefined) {
                    if (process.env.TRACE_LEVEL) {
                        console.warn(`${email} ${req.method} ${req.originalUrl} Timeout starting next batch of grooming; unclear result`);
                    }
                }
            } catch (error: any) {
                if (axios.isAxiosError(error) && error.response) {
                    const errorMessage = error.message;
                    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';
                    console.error(`${email} ${req.method} ${req.originalUrl} Unable to launch next batch of grooming - due to error: ${error.response.status}:${errorMessage} - ${errorDetails}`);
                } else {
                    console.error(`${email} ${req.method} ${req.originalUrl} Unable to launch next batch of grooming`, (error.stack || error));
                }
            }
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(projectsGroomed);

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_project_org_project_discovery = `user_project/:org/:project/discovery`;
app.get(`${api_root_endpoint}/${user_project_org_project_discovery}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const rawDiscoverState = await getProjectData(email, SourceType.General, org, project, '', 'discovery');

        let discoverState : DiscoverState | undefined = undefined;
        if (rawDiscoverState) {
            discoverState = JSON.parse(rawDiscoverState) as DiscoverState;

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(discoverState);
        } else {
            return res
                .status(HTTP_FAILURE_NOT_FOUND)
                .send('Project Discovery Status not found');
        }        

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_project_org_project_discovery}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'discovery');

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.post(`${api_root_endpoint}/${user_project_org_project_discovery}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl} Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl} Project is required`);
            }
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        let body = req.body;
        let requestor : DiscoveryTrigger | undefined;
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
            if (body !== '') {
                const discoverState : DiscoverState = JSON.parse(body);

                initializeResourcesToStart = discoverState.resetResources? discoverState.resetResources : false;

                requestor = discoverState.requestor? discoverState.requestor : requestor;
            }
        }

        // take the original request uri and remove the trailing /discovery to get the project data
        const originalUri = req.originalUrl;
        const projectDataUri = originalUri.substring(0, originalUri.lastIndexOf('/discovery'));
        const projectDataPath = projectDataUri.substring(projectDataUri.indexOf("user_project"));

        const resourcesToGenerate = [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification];

        const startProcessing : GeneratorState = {
            status: TaskStatus.Processing,
            };

        // if the user wants to reset the resources, then we'll ask each generator to restart
        if (initializeResourcesToStart) {
            startProcessing.stage = Stages.Reset;
            console.info(`${email} ${req.method} ${req.originalUrl} Resetting resources`);
        }

        const discoverState : DiscoverState = {
            lastUpdated: Date.now() / 1000,
            version: getCurrentVersion(),
        };
        if (requestor !== undefined) {
            discoverState.requestor = requestor;
        } else {
            discoverState.requestor = DiscoveryTrigger.UserManual;
        }
        if (discoverState.resetResources !== undefined) {
            discoverState.resetResources = discoverState.resetResources;
        }
        await storeProjectData(email, SourceType.General, req.params.org, req.params.project, '', 'discovery', discoverState);

        // kickoff project processing now, by creating the project resources in parallel
        //      We'll wait for up to 25 seconds to perform upload, then we'll do an upload
        //      with whatever we have at that time
        const generatorPromises = resourcesToGenerate.map(async (resource) => {
            const generatorPath = `${projectDataPath}/data/${resource}/generator`;

            try {
                const newGeneratorState = await localSelfDispatch<GeneratorState>(
                    email!,
                    '', 
                    req,
                    generatorPath,
                    'PUT',
                    startProcessing,
                    secondsBeforeRestRequestMaximumTimeout * 1000,
                    false);
                // check if we timed out, with an empty object
                if (Object.keys(newGeneratorState).length === 0) {
                    console.warn(`${email} ${req.method} ${req.originalUrl}  Async generator for ${resource} timed out after ${secondsBeforeRestRequestMaximumTimeout} seconds: ${JSON.stringify(newGeneratorState)}`);
                } else {
                    if (process.env.TRACE_LEVEL) {
                        console.log(`${email} ${req.method} ${req.originalUrl}  New Generator State: ${JSON.stringify(newGeneratorState)}`);
                    }
                }
            } catch (error: any) {
                if (axios.isAxiosError(error) && error.response) {
                    const errorMessage = error.message;
                    const errorDetails = error.response?.data?.body ?
                        error.response.data?.body: error.response.data? JSON.stringify(error.response.data) : 'No additional error information';
                    console.error(`${email} ${req.method} ${req.originalUrl} Discovery unable to launch generator (continuing) for ${generatorPath} - due to error: ${error.response.status}:${errorMessage} - ${errorDetails}`);
                } else {
                    console.error(`${email} ${req.method} ${req.originalUrl}  Discovery unable to launch generator (continuing) for ${generatorPath}`, (error.stack || error));
                }
            }
        });

        let existingDataReferences = undefined;
        try {
            // Execute all generator creation operations in parallel
            await Promise.all(generatorPromises);

            // due to above resource generation timeout of 25 seconds, we should have about 5 seconds to
            //      do the upload, which should be adequate time (e.g. 2-3 seconds)

            // After all generators have been started, proceed with data references
            const existingDataReferences = await localSelfDispatch<ProjectDataReference[]>(
                email,
                '', 
                req, 
                `${projectDataPath}/data_references`, 
                'PUT');

            console.log(`${email} ${req.method} ${req.originalUrl} Existing Data References: ${JSON.stringify(existingDataReferences)}`);
        } finally {
            const projectStatusRefreshRequest : ProjectStatusState = {
                status: ProjectStatus.Unknown,
                lastUpdated: Date.now() / 1000
            };

            // we're going to initialize an async project status refresh (but only wait a few milliseconds to make sure it starts)
            try {
                await localSelfDispatch<ProjectStatusState>(
                    email, "", req,
                    `${projectDataPath}/status`, 'PATCH', projectStatusRefreshRequest, millisecondsBeforeRestRequestMicroTimeout, false);
            } catch (error: any) {
                // we don't care if the project refresh fails - it's just a nice to have
                console.warn(`${email} ${req.method} ${req.originalUrl} Unable to start post-discovery async project status refresh for due to error: `, error.stack || error);
            }
        }

        return res.status(HTTP_SUCCESS).send(existingDataReferences);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }    
});

const MinutesToWaitBeforeGeneratorConsideredStalled = 3;

const user_project_org_project_status = `${user_project_org_project}/status`;
app.delete(`${api_root_endpoint}/${user_project_org_project_status}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'status');

        return res
            .status(HTTP_SUCCESS)
            .send();
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }    
});

app.patch(`${api_root_endpoint}/${user_project_org_project_status}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        let body = req.body;
        if (!body) {
            return handleErrorResponse(email, new Error("No body found"), req, res, "Invalid body", HTTP_FAILURE_BAD_REQUEST_INPUT);
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

        if (body === '' || body === undefined) {
            console.error(`${email} ${req.method} ${req.originalUrl} : empty body`);
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
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack || error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON');
        }

        const { org, project } = req.params;

        const rawProjectStatusData = await getProjectData(email, SourceType.General, org, project, '', 'status');

        let projectStatus : ProjectStatusState | undefined = undefined;
        if (rawProjectStatusData) {
            projectStatus = JSON.parse(rawProjectStatusData) as ProjectStatusState;
            projectStatus.status = updatedStatus.status;

            await storeProjectData(email, SourceType.General, org, project, '', 'status', projectStatus);

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
        return handleErrorResponse(email, error, req, res);
    }
});

app.get(`${api_root_endpoint}/${user_project_org_project_status}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        const readOnly = req.query?.readOnly !== undefined;

        const rawProjectStatusData = await getProjectData(email, SourceType.General, org, project, '', 'status');

        let projectStatus : ProjectStatusState | undefined = undefined;
        if (rawProjectStatusData) {
            projectStatus = JSON.parse(rawProjectStatusData) as ProjectStatusState;
        }

        // if we have no status, let's see if there's a real project here...
        const projectData = await loadProjectData(email, org, project);
        // if no project, then just HTTP_FAILURE_NOT_FOUND so user knows not to ask again
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        const msToWaitBeforeSkippingProjectStatus = 100;

        // if there's no project status or unknown project status - let's try and build one
        if (!readOnly && (!projectStatus || projectStatus.status === ProjectStatus.Unknown)) {
            // if we have a real project, and we have no status, then let's try and generate it now
            if (!projectStatus && process.env.TRACE_LEVEL) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Project Status not found; Project exists so let's refresh status`);
            }

            // project uri starts at 'user_project/'
            const project_subpath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
            // this will be a blocking call (when GET is normally very fast), but only to ensure we have an initial status
            projectStatus = await localSelfDispatch<ProjectStatusState>(email, getSignedIdentityFromHeader(req)!, req, project_subpath, 'POST',
                undefined, msToWaitBeforeSkippingProjectStatus, false);
        }

        if (!projectStatus?.status) {
            const unknownStatus : ProjectStatusState = {
                status: ProjectStatus.Unknown,
                lastUpdated : Math.floor(Date.now() / 1000)
            };
            return res
                .status(HTTP_SUCCESS_ACCEPTED)
                .contentType('application/json')
                .send(unknownStatus);
        }

        if (process.env.TRACE_LEVEL) {
            console.log(`${email} ${req.method} ${req.originalUrl} Project Status: ${JSON.stringify(projectStatus)}`);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(projectStatus);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.post(`${api_root_endpoint}/${user_project_org_project_status}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        const lookupAssistantId : boolean = req.query?.verifyAssistant !== undefined;

        let resourcesState : Map<string, string> = new Map<string, string>(
            [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification]
            .map((resource) => [resource, TaskStatus.Idle]));

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
            dataReferences = await localSelfDispatch<ProjectDataReference[]>(email,
                getSignedIdentityFromHeader(req)!, req, `${projectDataUri}/data_references`, 'GET');
        } catch (error: any) {
            if (axios.isAxiosError(error) && error.response && error.response.status === HTTP_FAILURE_UNAUTHORIZED) {
                const errorMessage = error.message;
                const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';
                console.error(`${email} ${req.method} ${req.originalUrl} Unable to get data references for ${projectDataUri} - due to error: ${error.response.status}:${errorMessage} - ${errorDetails}`);
                return handleErrorResponse(email, error, req, res);
            }

            // if we get an error, then we'll assume the project doesn't exist
            console.warn(`${email} ${req.method} ${req.originalUrl}: Project Data References not found; Project may not exist or hasn't been discovered yet: ${error}`);

            // we can continue on, since we're just missing the last synchronized time - which probably didn't happen anyway
        }
        
        if (lookupAssistantId) {

            const assistantMatched : ProjectAssistantInfo = {
                assistantId: '',
                matchedResources: [] as ProjectDataReference[],
                synchronized: false
            };

            const matchDataReferencesPerAssistant = async (assistant: OpenAIAssistant) : Promise<boolean> => {
                    // if we already found an assistant that matches, just stop looking... we assume only one assistant can match a file
                    if (assistantMatched.assistantId !== '') {
                        return false;
                    }
                    // skip assistants without files
                    if (!assistant.file_ids?.length) {
                        return false;
                    }
                    // see if any of our files match this assistant
                    for (const fileId of assistant.file_ids) {
                        const matchedDataReference = dataReferences.find((dataReference) => dataReference.id === fileId);
                        if (!matchedDataReference) {
                            continue;
                        }

                        assistantMatched.assistantId = assistant.id;
                        assistantMatched.matchedResources.push(matchedDataReference);
                    }

                    // only return one assistant that matches our files
                    return assistantMatched.assistantId !== '';
                };
                        
            // ideally we'd also match the project id to be very specific - but since the project id in Sara is a Guid,
            //    and the project name in backend is the user defined name, we can't match them up yet
            const assistantsMatched = await searchOpenAIAssistants(
                { email, org }, matchDataReferencesPerAssistant);
            if (assistantsMatched.length > 0) {
                assistantMatched.synchronized = assistantMatched.matchedResources.length === dataReferences.length;

                projectStatus.assistant = assistantMatched;
            }
        }
                
        for (const dataReference of dataReferences) {
            if (!dataReference.lastUpdated) {
                continue;
            }
            
            // pick the newest lastUpdated date - so we report the last updated date of the most recent resource sync
            if (!projectStatus.lastSynchronized || projectStatus.lastSynchronized < dataReference.lastUpdated) {
                projectStatus.lastSynchronized = dataReference.lastUpdated;
            }
        }

        // get the discovery state
        try {
            const discoverState : DiscoverState | undefined =
                await localSelfDispatch(email, getSignedIdentityFromHeader(req)!, req, `${projectDataUri}/discovery`, 'GET');

                projectStatus.lastDiscoveryTrigger = discoverState?.requestor;
                projectStatus.lastDiscoveryLaunch = discoverState?.lastUpdated;
                projectStatus.version = discoverState?.version;
        } catch (error: any) {
            if (!((error.response && error.response.status === HTTP_FAILURE_NOT_FOUND) ||
                (error.code === HTTP_FAILURE_NOT_FOUND.toString()))) {
                console.error(`${email} ${req.method} ${req.originalUrl} Unable to get project discovery data: `, error);
                return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
            }
            // if discovery state isn't found, we can still return the current project status
            //      we just won't have the discovery trigger info
        }

        // get the project data
        let projectData : UserProjectData;
        try {
            projectData = await localSelfDispatch<UserProjectData>(email, getSignedIdentityFromHeader(req)!, req, projectDataUri, 'GET');
        } catch (error: any) {
            if ((error.response && error.response.status === HTTP_FAILURE_NOT_FOUND) ||
                (error.code === HTTP_FAILURE_NOT_FOUND.toString())) {
                console.error(`${email} ${req.method} ${req.originalUrl}: Project not found: ${projectDataUri}`);
                return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
            } else if ((error.response && error.response.status === HTTP_FAILURE_UNAUTHORIZED) ||
                          (error.code === HTTP_FAILURE_UNAUTHORIZED.toString())) {
                console.error(`${email} ${req.method} ${req.originalUrl}: Unauthorized: ${projectDataUri}`);
                return res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
            }

            console.error(`${email} ${req.method} ${req.originalUrl}: Unable to get project data: `, error);
            return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
        }

        const saveProjectStatusUpdate = async () => {
            // save the project status
            try {
                // set current timestamp
                projectStatus.lastUpdated = Date.now() / 1000;
                projectStatus.resourcesState = Array.from(resourcesState.entries());

                await storeProjectData(email, SourceType.General, org, project, '', 'status', projectStatus);

            } catch (error) {
                console.error(`${email} ${req.method} ${req.originalUrl}: Unable to persist project status`, error);
            }
        }

        // if we have no resources, then we're done - report it as synchronized - since we have no data :)
        if (projectData.resources.length === 0) {
            projectStatus.status = ProjectStatus.Synchronized;
            projectStatus.details = `No GitHub resources found - nothing to synchronize`;
            console.log(`${email} ${req.method} ${req.originalUrl}: NO-OP : ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        const missingResources : string[] = [];

        const lastResourceUpdatedTimeStamp : Map<string, number> = new Map<string, number>();
        const possibleResources = [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification];
        for (const resource of possibleResources) {
            // check if this resource exists, and get its timestamp
            let resourceStatus : ResourceStatusState;
            try {
                resourceStatus = await localSelfDispatch<ResourceStatusState>(email, getSignedIdentityFromHeader(req)!, req, `${projectDataUri}/data/${resource}/status`, 'GET');
                if (process.env.TRACE_LEVEL) {
                    console.debug(`${email} ${req.method} ${req.originalUrl}: Resource ${resource} Status: ${JSON.stringify(resourceStatus)}`);
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

        const incompleteResources : Map<ProjectDataType, string> = new Map<ProjectDataType, string>();

        const currentResourceStatus : TaskStatus[] = [];
        const resourceErrorMessages : Map<ProjectDataType,string> = new Map<ProjectDataType,string>();
        for (const resource of possibleResources) {
            let generatorStatus : GeneratorState;
            try {
                generatorStatus = await localSelfDispatch<GeneratorState>(email, getSignedIdentityFromHeader(req)!, req, `${projectDataUri}/data/${resource}/generator`, 'GET');                console.debug
            } catch (error: any) {
                // if generator fails, we'll assume the resource isn't available either
                missingResources.push(resource);
                currentResourceStatus.push(TaskStatus.Error);
                resourceErrorMessages.set(resource, `Unable to get generator status for: ${resource}: ${JSON.stringify(error.stack || error)}`);
                resourcesState.set(resource, TaskStatus.Error);

                continue;
            }

            // determine the possible stages remaining based on the most stages remaining of the generators
            if (generatorStatus.processedStages !== undefined) {
                if (projectStatus.processedStages === undefined) {
                    projectStatus.processedStages = generatorStatus.processedStages;
                } else if (projectStatus.processedStages < generatorStatus.processedStages) {
                    projectStatus.processedStages = generatorStatus.processedStages;
                }
            }

            // set the possible stages remaining based on the most stages remaining of the generators
            if (generatorStatus.possibleStagesRemaining !== undefined) {
                if (projectStatus.possibleStagesRemaining === undefined) {
                    projectStatus.possibleStagesRemaining = generatorStatus.possibleStagesRemaining;
                } else if (generatorStatus.possibleStagesRemaining > projectStatus.possibleStagesRemaining) {
                    projectStatus.possibleStagesRemaining = generatorStatus.possibleStagesRemaining;
                }
            }
            // determine the maximum # of child resources
            if (generatorStatus.childResources && generatorStatus.childResources > 0) {
                if (projectStatus.childResources === undefined) {
                    projectStatus.childResources = generatorStatus.childResources;
                } else if (projectStatus.childResources < generatorStatus.childResources) {
                    projectStatus.childResources = generatorStatus.childResources;
                }
            }
            // determine the sync info on the source of the project resources (e.g. when was the data pulled from GitHub)
            if (generatorStatus.resourceStatus && generatorStatus.resourceStatus.length > 0) {
                // grab the first resource status as the source data status - since only project data should have this info
                if (projectStatus.sourceDataStatus === undefined) {
                    projectStatus.sourceDataStatus = generatorStatus.resourceStatus;
                } else {
                    console.warn(`${email} ${req.method} ${req.originalUrl}: Multiple resource status found for ${resource}`);
                }
            }

            resourcesState.set(resource, generatorStatus.status);

            // if this generator was last updated before the current known first generating time, then we'll assume it was the first
            firstResourceGeneratingTime = firstResourceGeneratingTime?
                Math.min(firstResourceGeneratingTime, generatorStatus.lastUpdated?generatorStatus.lastUpdated:firstResourceGeneratingTime):
                generatorStatus.lastUpdated;

            if (generatorStatus.status !== TaskStatus.Idle || generatorStatus.stage !== Stages.Complete) {
                currentResourceStatus.push(generatorStatus.status);

                // we need to determine if the generator is still processing, and if so, what the last updated time
                if (generatorStatus.status === TaskStatus.Processing) {
                    if (!lastResourceGeneratingTime) {
                        lastResourceGeneratingTime =  generatorStatus.lastUpdated;
                    } else if (!generatorStatus.lastUpdated) {
                        console.log(`${email} ${req.method} ${req.originalUrl} Can't get last generated time for: ${resource}`);
                    } else if (lastResourceGeneratingTime < generatorStatus.lastUpdated) {
                        lastResourceGeneratingTime = generatorStatus.lastUpdated;
                    }
                } else if (generatorStatus.status === TaskStatus.Error) {
                    resourceErrorMessages.set(resource, generatorStatus.statusDetails?generatorStatus.statusDetails:`Unknown error generating ${resource}`);
                }

                // if the generator is not completed, then we're not using the best resource data
                //      so even if we've synchronized, its only partial resource data (e.g. partial source, or incomplete blueprint)
                incompleteResources.set(resource, generatorStatus.statusDetails?generatorStatus.statusDetails:`Incomplete ${resource} data`);
                
                continue;
            }
            // if we've gotten here, then the generator is complete, so we'll use the last completed time
            if (!lastResourceCompletedGenerationTime || !generatorStatus.lastUpdated ||
                 lastResourceCompletedGenerationTime < generatorStatus.lastUpdated) {
                    // store the latest completion time
                lastResourceCompletedGenerationTime = generatorStatus.lastUpdated;
            }
            resourcesState.set(resource, Stages.Complete);
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
            projectStatus.details = `Generating Resources:\n`;
            if (missingResources.length > 0) {
                projectStatus.details += `\tNeeded: ${missingResources.join(', ')}`;
            }
            if (incompleteResources.size > 0) {
                const incompleteResourcesByName = Array.from(incompleteResources.keys()).map((resource) => `${resource}: ${incompleteResources.get(resource)}`);
                projectStatus.details += `\tGenerating:\n\t\t${incompleteResourcesByName.join('\n\t\t')}`;
            }
            if (resourceErrorMessages.size > 0) {
                const messageWithErrorsByResourceName = Array.from(resourceErrorMessages.keys()).map((resource) => `${resource}: ${resourceErrorMessages.get(resource)}`);
                projectStatus.details += `\tErrors encountered:\n\t\t${messageWithErrorsByResourceName.join('\n\t\t')}.`;
            }
            console.warn(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        // if the first resource was generated BEFORE the current project timestamp, then at least one of our resources is out of date
        //      so we'll mark the whole project as out of date
        if (firstResourceGeneratingTime && projectData.lastUpdated > (firstResourceGeneratingTime + 1)) {
            const projectLastUpdatedDate = new Date(projectData.lastUpdated * 1000);
            const firstResourceGeneratingDate = new Date(firstResourceGeneratingTime * 1000);

            projectStatus.status = ProjectStatus.OutOfDateProjectData;
            projectStatus.details = `Project was updated ${usFormatter.format(projectLastUpdatedDate)} since resources were last generated at ${usFormatter.format(firstResourceGeneratingDate)}`;

            // mark any resource that is complete as processing, since we are out of sync, and will need to refresh/update anyway
            Array.from(resourcesState.keys()).forEach((resource) => {
                // Check if the current value for the resource is Stages.Complete
                if (resourcesState.get(resource) === Stages.Complete) {
                    // Update the value to TaskStatus.Processing only if it was Stages.Complete
                    resourcesState.set(resource, TaskStatus.Processing);
                }
                // If the value is not Stages.Complete, no action is taken and the original value remains unchanged
            });

            console.error(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }        

        const inErrorState : boolean = currentResourceStatus.filter(status => status === TaskStatus.Error).length > 0;
        if (inErrorState) {
            projectStatus.status = ProjectStatus.ResourcesInError;
            projectStatus.details = `Some resource errors encountered:\n\t`;
            if (resourceErrorMessages.size > 0) {
                const messageWithErrorsByResourceName = Array.from(resourceErrorMessages.keys()).map((resource) => `${resource}: ${resourceErrorMessages.get(resource)}`);
                projectStatus.details += ` \n\t${messageWithErrorsByResourceName.join('\n\t')}.`;
            } else {
                projectStatus.details += `\nIncomplete Resources: ` + missingResources.concat(Array.from(incompleteResources.keys())).join('\n\t');
            }
            console.error(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

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
            console.error(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }
        // or if we have incomplete resources, we're stalled
        if (incompleteResources.size > 0) {
            projectStatus.status = ProjectStatus.ResourcesIncomplete;
            projectStatus.details = `Incomplete Resources: ${Array.from(incompleteResources.values()).join(', ')}`;
            console.error(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

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

            console.error(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

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

        let openAiFileCheckCalls = 0;
        const resourcesToCheck = [ProjectDataType.ArchitecturalBlueprint, ProjectDataType.ProjectSource, ProjectDataType.ProjectSpecification];
        for (const resource of resourcesToCheck) {
            const thisDataReference : ProjectDataReference | undefined = dataReferences.find(dataReference => dataReference.type === resource);

            if (lastResourceUpdatedTimeStamp.get(resource) && lastResourceUpdated < lastResourceUpdatedTimeStamp.get(resource)!) {
                lastResourceUpdated = lastResourceUpdatedTimeStamp.get(resource)!;
            }

            // if the upload doesn't exist or the file is missing from OpenAI, then we're out of date
            if (!thisDataReference || !thisDataReference.id) {
                outOfDateResources.push(resource);

                // if we're out of sync on this resource, mark it as processing since groomer will pick it up later
                resourcesState.set(resource, TaskStatus.Processing);
                continue;
            }
            const startTimeOfOpenAICall = Date.now();
            const existingFile : OpenAIFile | undefined = await getOpenAIFile(thisDataReference.id);
            const endTimeOfOpenAICall = Date.now();
            const remainingTimeOutOfOneSecond = 1000 - (endTimeOfOpenAICall - startTimeOfOpenAICall);
            // throttle openai call to 1 per second
            if (remainingTimeOutOfOneSecond > 0 && openAiFileCheckCalls < resourcesToCheck.length - 1) {
                await delay(remainingTimeOutOfOneSecond);
            }
            openAiFileCheckCalls++;
            // if the openai file doesn't exist, then report it missing and continue
            if (!existingFile) {
                outOfDateResources.push(resource);

                // if we're out of sync on this resource, mark it as processing since groomer will pick it up later
                resourcesState.set(resource, TaskStatus.Processing);
                continue;
            }

            if (thisDataReference.lastUpdated < lastResourceUpdatedTimeStamp.get(resource)!) {

                outOfDateResources.push(resource);

                // if we're out of sync on this resource, mark it as processing since groomer will pick it up later
                resourcesState.set(resource, TaskStatus.Processing);
            }

        }

        const lastResourceCompletedDate = new Date(lastResourceUpdated * 1000);

        // now that our resources have completed generation, we want to make sure the data_references timestamp is AFTER the generators completed
        //      otherwise, we'll report that the resources are not synchronized
        if (!projectStatus.lastSynchronized) {
            // if we've never synchronized the data, then report not synchronized
            projectStatus.status = ProjectStatus.ResourcesNotSynchronized;
            projectStatus.details = `Resources Completed Generation at ${usFormatter.format(lastResourceCompletedDate)} but never Synchronized to AI Servers`;
            console.error(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

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
            projectStatus.details = `${outOfDateResources.join(", ")} Resources Completed Generation at ${usFormatter.format(lastResourceCompletedDate)} is newer than last Synchronized AI Server at ${usFormatter.format(lastSynchronizedDate)}`;

            // mark any resource that is complete as processing, since we are out of date, and will need to refresh/update anyway
            Array.from(resourcesState.keys()).forEach((resource) => {
                // Check if the current value for the resource is Stages.Complete
                if (resourcesState.get(resource) === Stages.Complete) {
                    // Update the value to TaskStatus.Processing only if it was Stages.Complete
                    resourcesState.set(resource, TaskStatus.Processing);
                }
                // If the value is not Stages.Complete, no action is taken and the original value remains unchanged
            });

            console.error(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        if (lookupAssistantId && !projectStatus.assistant) {
            projectStatus.status = ProjectStatus.AssistantNotAttached;
            projectStatus.details = `Resources Completely Generated, but no Assistant Attached`;

            console.error(`${email} ${req.method} ${req.originalUrl}: ISSUE ${JSON.stringify(projectStatus)}`);

            await saveProjectStatusUpdate();

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(projectStatus);
        }

        if (lookupAssistantId && projectStatus.assistant && !projectStatus.assistant.synchronized) {
            projectStatus.status = ProjectStatus.AssistantOutOfDate;
            projectStatus.details = `Resources Completely Generated, but Assistant ${projectStatus.assistant.assistantId} does not include all files`;

            console.error(`${email} ${req.method} ${req.originalUrl}}: ISSUE ${JSON.stringify(projectStatus)}`);

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

        console.log(`${email} ${req.method} ${req.originalUrl}: SYNCHRONIZED: ${JSON.stringify(projectStatus)}`);

        await saveProjectStatusUpdate();

        return res
            .status(HTTP_SUCCESS)
            .send(projectStatus);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }    
});

enum GroomingStatus {
    Idle = 'Idle',
    LaunchPending = 'Pending',
    Grooming = 'Grooming',
    Skipping = 'Skipping',
    Error = 'Error',
    Disabled = 'Disabled'
}

interface ProjectGroomState {
    status: GroomingStatus;
    statusDetails?: string;
    consecutiveErrors: number;
    lastDiscoveryStart?: number;
    lastUpdated: number;
}

const user_project_org_project_groom = `${user_project_org_project}/groom`;
app.get(`${api_root_endpoint}/${user_project_org_project_groom}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
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
        return handleErrorResponse(email, error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_project_org_project_groom}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl} Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl} Project is required`);
            }
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'groom');

        return res
            .status(HTTP_SUCCESS)
            .send();
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }    
});

const didLastDiscoverySucceedOrFail = (
    groomStatus: ProjectGroomState,
    lastDiscovery: DiscoverState | undefined,
    projectStatus: ProjectStatusState) : boolean | undefined => {
    // if we didn't launch a discovery, then assume it would have succeeded
    if (!groomStatus.lastDiscoveryStart) {
        return true;
    }

    // if groomer is in whatif mode, then we'll just return if we are fully synchronized
    if (!process.env.DISCOVERY_GROOMER || process.env.DISCOVERY_GROOMER.toLowerCase() === 'whatif') {
        return projectStatus.synchronized;
    }

    // if groomer launched after last project status then unknown
    if (groomStatus.lastDiscoveryStart > projectStatus.lastUpdated) {
        return undefined;
    }

    // if the last discovery time of the project is before our groomer ran, then unknown
    if (lastDiscovery?.lastUpdated && groomStatus.lastDiscoveryStart >= lastDiscovery.lastUpdated) {
        return undefined;
    }

    // if the project is synchronized and the groomer launched before the last synchronization, then we're good
    if (projectStatus.lastSynchronized &&
        groomStatus.lastDiscoveryStart < projectStatus.lastSynchronized) {
        return true;
    }

    // if the groomer didn't launch the discovery, then we can't be sure what effect the groomer would have
    if (lastDiscovery?.requestor !== DiscoveryTrigger.AutomaticGrooming) {
        return undefined;
    }

    // otherwise, we'll assume the groomer discovery launched before the last project update (or update attempt)
    //      and we're not synchronized - due to an error
    return false;
}

const MaxGroomingErrorsBeforeManualDiscovery = 3;

app.post(`${api_root_endpoint}/${user_project_org_project_groom}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const projectGroomPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
        const projectPath = projectGroomPath.substring(0, projectGroomPath.lastIndexOf('/groom'));

        const callStart = Math.floor(Date.now() / 1000);
        const groomingCyclesToWaitForSettling = 2;

        // force grooming to run even if we're in the middle of a grooming cycle
        const force = req.query.force !== undefined?true:false;

        // reset the grooming error count to enable automated grooming to restart
        const reset = req.query.reset !== undefined?true:false;

        const whatif = req.query.whatif !== undefined?true:false;

        const storeGroomingState = async (groomingState: ProjectGroomState) => {
            if (whatif) {
                console.info(`${email} ${req.method} ${req.originalUrl} WhatIf Mode - skipping store of grooming state: ${JSON.stringify(groomingState)}`);
                return;
            }
            await storeProjectData(email, SourceType.General, req.params.org, req.params.project, '', 'groom', groomingState);
        }

        // if the project doesn't exist, then we shouldn't be grooming it - so delete any groom data we created and return not found
        const projectData = await loadProjectData(email, req.params.org, req.params.project);
        if (!projectData) {
            try {
                await localSelfDispatch(email, getSignedIdentityFromHeader(req)!, req, `${projectPath}/groom`, 'DELETE');
                console.info(`${email} ${req.method} ${req.originalUrl} Deleted project groom data - since project not found`);
            } catch (error) {
                console.error(`${email} ${req.method} ${req.originalUrl} Unable to delete project groom data: ${error}`);
            }
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        let body = req.body;
        if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
            if (Object.keys(body).length === 0) {
                // If it's an empty object
                body = undefined;
            } else {
                // If it's a non-empty object, you might want to handle it differently
                // For example, convert it to a JSON string
                body = JSON.stringify(body);
            }
        } else if (typeof body !== 'string') {
            if (Buffer.isBuffer(body)) {
                body = body.toString('utf8');
            }
        } else if (body === '') {
            body = undefined;
        }
        
        let input : ProjectGroomState | undefined;
        try {
            input = body?JSON.parse(body):undefined;
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack || error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON Body');
        }

        const currentGroomingStateRaw = await getProjectData(email, SourceType.General, req.params.org, req.params.project, '', 'groom');
        const currentGroomingState: ProjectGroomState | undefined = currentGroomingStateRaw?JSON.parse(currentGroomingStateRaw):input;

        if (currentGroomingState || input) {
            if (!currentGroomingState) {
                throw new Error(`Invalid State - currentGroomingState is undefined with input specified ${JSON.stringify(input)}`);
            }
            // if caller requested to reset the max error count, then we'll reset it
            if (reset) {
                if (input?.consecutiveErrors !== undefined) {
                    console.info(`${email} ${req.method} ${req.originalUrl} Reset grooming error count to 0 from input: ${input.consecutiveErrors}`);
                    input.consecutiveErrors = 0;
                } else if (currentGroomingState?.consecutiveErrors !== undefined) {
                    console.info(`${email} ${req.method} ${req.originalUrl} Reset grooming error count to 0 from current: ${currentGroomingState.consecutiveErrors}`);
                    currentGroomingState.consecutiveErrors = 0;
                }
            }
            if (input) {
                currentGroomingState.status = input.status;
                if (input.statusDetails) {
                    currentGroomingState.statusDetails = input.statusDetails;
                }
                if (input.consecutiveErrors) {
                    currentGroomingState.consecutiveErrors = input.consecutiveErrors;
                }
                if (input.lastDiscoveryStart) {
                    currentGroomingState.lastDiscoveryStart = input.lastDiscoveryStart;
                }
                currentGroomingState.lastUpdated = Math.floor(Date.now() / 1000);

                await storeGroomingState(currentGroomingState);
                console.info(`${email} ${req.method} ${req.originalUrl} Stored new grooming state for immediate processing: ${JSON.stringify(input)}`);
            }

            if (currentGroomingState.status === GroomingStatus.Disabled) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Grooming is disabled - skipping: ${JSON.stringify(currentGroomingState)}`);
                return res
                    .status(HTTP_LOCKED)
                    .send(currentGroomingState);
            }

            const cycleBusyWindowPercentage = 0.75; // don't overlap last 75% of the grooming cycle
            // we only run at most once every grooming cycle - with adjustment for lag (e.g. checking status took part of the last cycle)
            //  this ensures we settle whatever processing happened in the last cycle
            const endOfNextGroomingWindowTimeInSeconds = currentGroomingState.lastUpdated + (cycleBusyWindowPercentage * DefaultGroomingIntervalInMinutes * 60);
            if (!force && callStart < endOfNextGroomingWindowTimeInSeconds) {
                const nextOpeningDate = new Date(endOfNextGroomingWindowTimeInSeconds * 1000);
                const lastGroomingTime = new Date(currentGroomingState.lastUpdated * 1000);
                const groomerBusy : ProjectGroomState = {
                    status: GroomingStatus.Skipping,
                    statusDetails: `Last updated at ${usFormatter.format(lastGroomingTime)} - waiting to restart groomer at ${usFormatter.format(nextOpeningDate)}`,
                    consecutiveErrors: 0, // we're skipping so we don't know the error status
                    lastDiscoveryStart: currentGroomingState.lastDiscoveryStart,
                    lastUpdated: Math.floor(Date.now() / 1000)
                };
                console.warn(`${email} ${req.method} ${req.originalUrl} Groomer cycle active - skipping: ${JSON.stringify(groomerBusy)}`);
                return res
                    .status(HTTP_LOCKED)
                    .contentType('application/json')
                    .send(groomerBusy);
            }

            // get the time outside the grooming cycle window - e.g. at least 2 full grooming cycles
            const timeOutsideTheLongGroomingCycleWindow = callStart - (groomingCyclesToWaitForSettling * DefaultGroomingIntervalInMinutes * 60);

            // did the last discovery start within our long grooming cycle window
            if (!force && currentGroomingState.lastDiscoveryStart &&
                currentGroomingState.lastDiscoveryStart > timeOutsideTheLongGroomingCycleWindow) {

                // we only skip if we were actively grooming before... otherwise, we'll just let it run
                //      (e.g. if we hit an error or another issue)
                if (currentGroomingState.status === GroomingStatus.Grooming) {

                    const groomingTime = new Date(currentGroomingState.lastDiscoveryStart * 1000);
                    const groomingLongWindowEnd = currentGroomingState.lastDiscoveryStart + (groomingCyclesToWaitForSettling * DefaultGroomingIntervalInMinutes * 60);
                    const groomingLongWindowEndTime = new Date(groomingLongWindowEnd * 1000);
                    const groomerBusy : ProjectGroomState = {
                        status: GroomingStatus.Skipping,
                        statusDetails: `Last discovery started at ${usFormatter.format(groomingTime)} - waiting until ${usFormatter.format(groomingLongWindowEndTime)}`,
                        consecutiveErrors: 0, // we're skipping so we don't know the error status
                        lastDiscoveryStart: currentGroomingState.lastDiscoveryStart,
                        lastUpdated: Math.floor(Date.now() / 1000)
                    };
                    console.warn(`${email} ${req.method} ${req.originalUrl} Groomer is busy - skipping: ${JSON.stringify(groomerBusy)}`);
                    return res
                        .status(HTTP_LOCKED)
                        .contentType('application/json')
                        .send(groomerBusy);
                }
            }

            if (currentGroomingState.status === GroomingStatus.LaunchPending) {
                // if the last update of the groomer was within than 2 grooming cycle windows, and we have a pending launch
                //     then we'll skip this run
                if (!force && currentGroomingState.lastUpdated > timeOutsideTheLongGroomingCycleWindow) {

                    // if we're in a pending state, then we'll just skip this run
                    const groomingState = {
                        status: GroomingStatus.Skipping,
                        statusDetails: 'Grooming Launch Pending',
                        consecutiveErrors: currentGroomingState.consecutiveErrors,
                        lastDiscoveryStart: currentGroomingState.lastDiscoveryStart,
                        lastUpdated: Math.floor(Date.now() / 1000)
                    };
                    console.warn(`${email} ${req.method} ${req.originalUrl} Grooming Launch Pending - skipping: ${JSON.stringify(groomingState)}`);
                    return res
                        .status(HTTP_LOCKED)
                        .contentType('application/json')
                        .send(groomingState);
                }
            }
        }

        // we'll check the status of the project data
        let projectStatus : ProjectStatusState;
        try {
            projectStatus = await localSelfDispatch<ProjectStatusState>(email, "", req, `${projectPath}/status`, 'GET');
        } catch (error: any) {
            if ((error.response && error.response.status === HTTP_FAILURE_NOT_FOUND) ||
                (error.code === HTTP_FAILURE_NOT_FOUND.toString())) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Project Status not found; Project may not exist or hasn't been discovered yet`);
                return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
            }
            return handleErrorResponse(email, error, req, res, `Unable to query Project Status`);
        }

        if (projectStatus.status === ProjectStatus.Unknown) {
            // if we're in an unknown project state, then we'll just skip this run - try looking up status again next time
            const groomingState : ProjectGroomState = {
                status: GroomingStatus.Skipping,
                statusDetails: 'Grooming check skipped while Project Status refreshing',
                consecutiveErrors: 0,
                lastDiscoveryStart: 0,
                lastUpdated: Math.floor(Date.now() / 1000)
            };
            console.warn(`${email} ${req.method} ${req.originalUrl} Project Status is Unknown - skipping: ${JSON.stringify(groomingState)}`);
            return res
                .status(HTTP_SUCCESS_ACCEPTED)
                .contentType('application/json')
                .send(groomingState);
        }

        // we'll check the status of the project data
        let lastDiscovery : DiscoverState | undefined = undefined;
        try {
            lastDiscovery = await localSelfDispatch<ProjectStatusState>(email, "", req, `${projectPath}/discovery`, 'GET');
        } catch (error: any) {
            if (!((error.response && error.response.status === HTTP_FAILURE_NOT_FOUND) ||
                (error.code === HTTP_FAILURE_NOT_FOUND.toString()))) {
                return handleErrorResponse(email, error, req, res, `Unable to query Project Discovery Status`);
            }
            console.warn(`${email} ${req.method} ${req.originalUrl} Last Project Discovery not found; groomer may be running before discovery has been started`);
        }
        
        // if the project is actively updating/discovery, then groomer will be idle
        if (projectStatus.activelyUpdating) {
            const groomingState = {
                status: GroomingStatus.Skipping,
                statusDetails: 'Project is actively updating',
                consecutiveErrors: currentGroomingState?currentGroomingState.consecutiveErrors:0,
                lastDiscoveryStart: currentGroomingState?currentGroomingState.lastDiscoveryStart:undefined,
                lastUpdated: Math.floor(Date.now() / 1000)
            };

            await storeGroomingState(groomingState);
            console.warn(`${email} ${req.method} ${req.originalUrl} Project is actively updating - skipping: ${JSON.stringify(groomingState)}`);

            return res
                .status(HTTP_SUCCESS_ACCEPTED)
                .contentType('application/json')
                .send(groomingState);
        }

        // if project is synchronized, then nothing to do
        if (projectStatus.status === ProjectStatus.Synchronized) {
            const synchronizedDate = new Date(projectStatus.lastSynchronized! * 1000);
            const groomingState = {
                status: GroomingStatus.Idle,
                statusDetails: `Project is synchronized by Discovery[${lastDiscovery?.requestor}] as of ${usFormatter.format(synchronizedDate)} - Idling Groomer`,
                consecutiveErrors: 0, // since the project synchronized, assume groomer did or could work, so reset the error counter
                lastDiscoveryStart: currentGroomingState?currentGroomingState.lastDiscoveryStart:undefined,
                lastUpdated: Math.floor(Date.now() / 1000)
            };

            // reset the groomer for this project, since we've reached synchronization
            await storeGroomingState(groomingState);
            console.log(`${email} ${req.method} ${req.originalUrl} Project is synchronized by Discovery[${lastDiscovery?.requestor}] - idling: ${JSON.stringify(groomingState)}`);

            return res
                .status(HTTP_SUCCESS_ACCEPTED)
                .contentType('application/json')
                .send(groomingState);
        }

        // if the discovery was launched or pending - and the discovery itself wasn't received,
        //     then it seems the actual launch didn't work, so we'll reset the discovery
        if (currentGroomingState?.status === GroomingStatus.LaunchPending ||
            currentGroomingState?.status === GroomingStatus.Grooming) {

            if (lastDiscovery?.requestor !== DiscoveryTrigger.AutomaticGrooming) {

                if (!process.env.DISCOVERY_GROOMER || process.env.DISCOVERY_GROOMER.toLowerCase() === 'whatif') {

                    // for the WhatIf case, we only want to simulate the groomer, so we'll record it as an error
                    console.warn(`${email} ${req.method} ${req.originalUrl} Last Discovery(${lastDiscovery?.requestor}) was not the Groomer(WhatIf) - resetting to error`);
                    currentGroomingState.status = GroomingStatus.Error;
                    currentGroomingState.statusDetails = `Last Discovery(${lastDiscovery?.requestor}) was not the Groomer(WhatIf) - resetting to error`;
                    currentGroomingState.consecutiveErrors = currentGroomingState.consecutiveErrors?currentGroomingState.consecutiveErrors + 1:1;

                } else {
                    currentGroomingState.status = GroomingStatus.Idle;
                    currentGroomingState.statusDetails = `Last Discovery (${lastDiscovery?.requestor}) was not the Groomer - resetting to idle`;
                }
            } else if (lastDiscovery?.lastUpdated && currentGroomingState.lastDiscoveryStart &&
                lastDiscovery.lastUpdated < currentGroomingState.lastDiscoveryStart) {

                console.warn(`${email} ${req.method} ${req.originalUrl} Last Groomer Launch wasn't received by the Project Discovery - resetting discovery`);
    
                currentGroomingState.status = GroomingStatus.Idle;
                currentGroomingState.statusDetails = `Last Groomer Launch at ${usFormatter.format(new Date(currentGroomingState.lastDiscoveryStart * 1000))} ` +
                    `wasn't received by Project Discovery - ` +
                    `which was last updated at ${usFormatter.format(new Date(lastDiscovery.lastUpdated * 1000))} - resetting to idle`;
            }
        }

        const timeRemainingToDiscoverInSeconds = secondsBeforeRestRequestMaximumTimeout - (Math.floor(Date.now() / 1000) - callStart);
        // if we have less than one second to run discovery, just skip it for now, and we'll try again later (status refresh took too long)
        if (timeRemainingToDiscoverInSeconds <= 1) {
            const groomingState = {
                status: GroomingStatus.Skipping,
                statusDetails: `Insufficient time to rediscover: ${timeRemainingToDiscoverInSeconds} seconds remaining`,
                consecutiveErrors: currentGroomingState?currentGroomingState.consecutiveErrors:0,
                lastDiscoveryStart: currentGroomingState?currentGroomingState.lastDiscoveryStart:undefined,
                lastUpdated: Math.floor(Date.now() / 1000)
            };

            await storeGroomingState(groomingState);

            console.warn(`${email} ${req.method} ${req.originalUrl} Insufficient time to rediscover - skipping: ${JSON.stringify(groomingState)}`);

            return res
                .status(HTTP_SUCCESS_ACCEPTED)
                .contentType('application/json')
                .send(groomingState);
        }

        // get the result of the last discovery launched by discovery
        const lastDiscoveryResult: boolean | undefined = currentGroomingState?
            didLastDiscoverySucceedOrFail(currentGroomingState, lastDiscovery, projectStatus):undefined;

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
                    statusDetails: `Groomer has reached maximum errors (${MaxGroomingErrorsBeforeManualDiscovery}) - Manual Discovery Required`,
                    lastDiscoveryStart: currentGroomingState.lastDiscoveryStart,
                    consecutiveErrors: currentGroomingState.consecutiveErrors,
                    lastUpdated: Math.floor(Date.now() / 1000)
                };

                await storeGroomingState(groomingState);
                console.error(`${email} ${req.method} ${req.originalUrl} Groomer has reached maximum errors (${MaxGroomingErrorsBeforeManualDiscovery}) - skipping: ${JSON.stringify(groomingState)}`);

                return res
                    .status(HTTP_SUCCESS)
                    .contentType('application/json')
                    .send(groomingState);
            }

            currentGroomingState.consecutiveErrors++;
        } else {
            // if we don't know if the last discovery worked, or we're starting fresh (no current groomer state), then we'll just start grooming
            //      and we'll assume it will work
            if (currentGroomingState?.consecutiveErrors &&
                currentGroomingState.consecutiveErrors > MaxGroomingErrorsBeforeManualDiscovery) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Groomer errors (${currentGroomingState.consecutiveErrors} bypassing maximum errors (${MaxGroomingErrorsBeforeManualDiscovery}) due to unknown last groomer result`);
            }
        }

        const groomingDiscoveryState : DiscoverState = {
            resetResources: projectStatus.status === ProjectStatus.OutOfDateProjectData,
            requestor: DiscoveryTrigger.AutomaticGrooming
        };

        const discoveryStart = Math.floor(Date.now() / 1000);
        const discoveryTime = new Date(discoveryStart * 1000);
        const launchedGroomingState : ProjectGroomState = {
            status: GroomingStatus.LaunchPending,
            lastDiscoveryStart: discoveryStart,
            consecutiveErrors: currentGroomingState?currentGroomingState.consecutiveErrors:0,
            lastUpdated: Math.floor(Date.now() / 1000)
        };

        try {
            launchedGroomingState.status = GroomingStatus.Grooming;

            if (whatif || !process.env.DISCOVERY_GROOMER || process.env.DISCOVERY_GROOMER.toLowerCase() === 'whatif') {
                launchedGroomingState.statusDetails = `Launched WhatIf Discovery at ${discoveryTime} for ${projectPath} with status ${JSON.stringify(projectStatus)}`;
                console.log(`${email} ${req.method} ${req.originalUrl} Launching Groomer[whatif] Discovery with status ${JSON.stringify(projectStatus)}`);
            } else {
                // "automatic" is the recommended trigger, but any non-empty value will work
                console.log(`${email} ${req.method} ${req.originalUrl} Launching Groomer[${process.env.DISCOVERY_GROOMER}] Discovery with status ${JSON.stringify(projectStatus)}`);

                const discoveryResult = await localSelfDispatch<ProjectDataReference[]>(
                    email, "", req,
                    `${projectPath}/discovery`, 'POST',
                    groomingDiscoveryState,
                    timeRemainingToDiscoverInSeconds * 1000);

                    // if discovery result is an empty object (i.e. {}), then we launched discovery but don't know if it finished (e.g. timeout waiting)
                if (!discoveryResult || !Object.keys(discoveryResult).length) {
                    launchedGroomingState.statusDetails = `Launched Async Discovery at ${usFormatter.format(discoveryTime)}, but no result yet`;
                } else {
                    // even though discovery launched, and didn't timeout... we don't know if it finished or not
                    //      only that the async launch didn't timeout/fail
                    launchedGroomingState.statusDetails = `Launched Discovery at ${usFormatter.format(discoveryTime)} ${JSON.stringify(discoveryResult)}`;
                }
            }

            await storeGroomingState(launchedGroomingState);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(launchedGroomingState);
        } catch (error) {
            console.error(`${email} ${req.method} ${req.originalUrl} Groomer unable to launch discovery for ${projectPath}`, error);

            launchedGroomingState.status = GroomingStatus.Error;
            launchedGroomingState.statusDetails = `Error launching discovery: ${error}`;
            launchedGroomingState.consecutiveErrors++;

            await storeGroomingState(launchedGroomingState);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(launchedGroomingState);
        }

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }    
});

const user_project_org_project_goals = `${user_project_org_project}/goals`;
app.delete(`${api_root_endpoint}/${user_project_org_project_goals}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl} Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl} Project is required`);
            }
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        await deleteProjectData(email, SourceType.General, org, project, '', 'goals');

        return res
            .status(HTTP_SUCCESS)
            .send();
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }    
});

app.post(`${api_root_endpoint}/${user_project_org_project_goals}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;

        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl} Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl} Project is required`);
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

        if (body === '' || body === undefined) {
            console.error(`${email} ${req.method} ${req.originalUrl} ${user_profile}: empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        // Parse the body string to an object
        let updatedGoals;
        try {
            updatedGoals = JSON.parse(body);
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON');
        }

        await storeProjectData(email, SourceType.General, org, project, '', 'goals', updatedGoals);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(updatedGoals);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
    
});

app.get(`${api_root_endpoint}/${user_project_org_project_goals}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
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
        return handleErrorResponse(email, error, req, res);
    }

});

const user_project_org_project_config_boostignore = `${user_project_org_project}/config/.boostignore`;
app.get(`${api_root_endpoint}/${user_project_org_project_config_boostignore}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
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
        return handleErrorResponse(email, error, req, res);
    }
});

const user_project_org_project_data_resource = `${user_project_org_project}/data/:resource`;
app.get(`${api_root_endpoint}/${user_project_org_project_data_resource}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const projectData = await loadProjectData(email, org, project);
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
        const resourceData = await getCachedProjectData<string>(email, SourceType.GitHub, ownerName, repoName, '', resource);
        if (!resourceData) {
            return handleErrorResponse(email, new Error(`Resource not found: ${ownerName}/${repoName}/data/${resource}`), req, res, undefined, HTTP_FAILURE_NOT_FOUND);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('text/plain')
            .send(resourceData);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

interface ResourceStatusState {
    lastUpdated: number;
}

const user_project_org_project_data_resource_status = `${user_project_org_project_data_resource}/status`;
app.get(`${api_root_endpoint}/${user_project_org_project_data_resource_status}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const projectData = await loadProjectData(email, org, project);
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

        let resourceStatus : ResourceStatusState | undefined =
            await getCachedProjectData<ResourceStatusState>(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status");
        if (!resourceStatus?.lastUpdated) {
            // if the resource status was not found, check if the resource exists... we may just be missing the status
            // so we'll regenerate the status
            const resourceData = await getCachedProjectData<string>(email, SourceType.GitHub, ownerName, repoName, '', resource, false);
            // resource doesn't exist, so just report missing/Not Found
            if (!resourceData) {
                return handleErrorResponse(email, new Error(`${user_project_org_project_data_resource_status}: not found: ${ownerName}/${repoName}/data/${resource}`), req, res, undefined, HTTP_FAILURE_NOT_FOUND);
            }
            // resource exists, so we'll generate the status
            const resourceStatusWithTimestamp : ResourceStatusState = {
                lastUpdated: Math.floor(Date.now() / 1000)
            };
            await storeProjectData(email, SourceType.GitHub, ownerName, repoName, `resource/${resource}`, "status", resourceStatusWithTimestamp);
            console.warn(`${email} ${req.method} ${req.originalUrl} Missing status for resource: generating with current timestamp`);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(resourceStatus);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_project_org_project_data_resource}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const projectData = await loadProjectData(email, org, project);
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

        try {
            const statusPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project")) + `/status`;
            await localSelfDispatch<void>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, statusPath, 'DELETE');
        } catch (error: any) { // ignore 404 errors
            if (!error.code || error.code !== HTTP_FAILURE_NOT_FOUND.toString()) {
                console.warn(`${email} ${req.method} ${req.originalUrl}  Unable to delete resource status for ${org}/${project} - due to error: ${error}`);
            }
        }

        try {
            const generatorPath = req.originalUrl.substring(req.originalUrl.indexOf("user_project")) + `/generator`;
            await localSelfDispatch<void>(email, (await signedAuthHeader(email))[header_X_Signed_Identity], req, generatorPath, 'DELETE');
        } catch (error: any) { // ignore 404 errors
            if (!error.code || error.code !== HTTP_FAILURE_NOT_FOUND.toString()) {
                console.warn(`${email} ${req.method} ${req.originalUrl}  Unable to delete resource generator for ${org}/${project} - due to error: ${error}`);
            }
        }

        return res
            .status(HTTP_SUCCESS)
            .send();
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

// Middleware for parsing plain text with a limit of 1mb
const textParserWithMbLimit = bodyParser.text({ limit: '1mb' });

app.route(`${api_root_endpoint}/${user_project_org_project_data_resource}`)
   .post(textParserWithMbLimit, postOrPutUserProjectDataResource)
   .put(textParserWithMbLimit, postOrPutUserProjectDataResource);

const user_project_org_project_data_resource_generator = `${user_project_org_project_data_resource}/generator`;
app.delete(`${api_root_endpoint}/${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const projectData = await loadProjectData(email, org, project);
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
        return handleErrorResponse(email, error, req, res);
    }
});

app.get(`${api_root_endpoint}/${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error(`Org is required`), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!project) {
                return handleErrorResponse(email, new Error(`Project is required`), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
        }

        const projectData = await loadProjectData(email, org, project);
        if (!projectData) {
            return handleErrorResponse(email, new Error(`Project not found`), req, res, undefined, HTTP_FAILURE_NOT_FOUND);
        }

        const uri = new URL(projectData.resources[0].uri);
        // Split the pathname by '/' and filter out empty strings
        const pathSegments = uri.pathname.split('/').filter(segment => segment);

        // The relevant part is the last segment of the path
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            return handleErrorResponse(email, new Error(`Invalid URI: ${uri}`), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const { _, __, resource } = req.params;
        const currentInput = await getProjectData(email, SourceType.GitHub, ownerName, repoName, '', `${resource}/generator`);
        if (!currentInput) {
            console.log(`${email} ${req.method} ${req.originalUrl} : simulated idle data`);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send({status: TaskStatus.Idle} as GeneratorState);
        } else {

            // for backward compatibility (old field name)
            if ((currentInput as any)?.status_details) {
                currentInput.statusDetails = (currentInput as any).status_details;
                delete (currentInput as any).status_details;
            }

            // Ensure parsing safety with a try-catch around JSON.parse
            try {
                const generatorData = JSON.parse(currentInput) as GeneratorState;

                // Additional checks can be placed here to ensure generatorData contains expected properties
                return res
                    .status(HTTP_SUCCESS)
                    .contentType('application/json')
                    .send(generatorData);
            } catch (parseError: any) {
                console.error(`${email} ${req.method} ${req.originalUrl} Parsing error for generator data: `, parseError.stack || parseError);

                return res
                    .status(HTTP_SUCCESS)
                    .contentType('application/json')
                    .send({status: TaskStatus.Error, statusDetails: `Parsing error for generator data: ${parseError.stack || parseError}`} as GeneratorState);
            }
        }
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

// for updating the generator task status
app.patch(`${api_root_endpoint}/${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return res;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl}: Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl}: Project is required`);
            }

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project);
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        const uri = new URL(projectData.resources[0].uri);
        const pathSegments = uri.pathname.split('/').filter(segment => segment);
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const forcedUpdate = (req.query.force !== undefined) || false;
        const { _, __, resource } = req.params;
        let currentGeneratorState : GeneratorState =
            await getProjectData(email, SourceType.GitHub, ownerName, repoName, '', `${resource}/generator`);
        if (!currentGeneratorState) {
            console.warn(`${email} ${req.method} ${req.originalUrl}: No generator to patch`);
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
        if (body === '' || body === undefined) {
            console.error(`${email} ${req.method} ${req.originalUrl}: empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        let input : GeneratorState;
        try {
            input = JSON.parse(body);
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack || error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON Body');
        }
        // we only allow status changes via PATCH if force is set ; otherwise, we're only doing a progress update
        if (forcedUpdate && input.status !== undefined) {
            currentGeneratorState.status = input.status;
        }
        // the status should never change unexpectedly
        if (!forcedUpdate && input.status !== currentGeneratorState.status) {
            if (currentGeneratorState.status === TaskStatus.Error &&
                input.status === TaskStatus.Processing) {
                return res
                    .status(HTTP_LOCKED)
                    .send('Generator in error state - cannot process more updates');
            }
            console.error(`${email} ${req.method} ${req.originalUrl}: Invalid new status: ${input.status} from ${currentGeneratorState.status}`);
            return res.status(HTTP_CONFLICT).send(`Invalid PATCH status: ${input.status} from ${currentGeneratorState.status}`);
        }
        if (input.lastUpdated) {
            currentGeneratorState.lastUpdated = input.lastUpdated;
        }
        if (input.possibleStagesRemaining !== undefined) {
            currentGeneratorState.possibleStagesRemaining = input.possibleStagesRemaining;
        }
        if (input.processedStages !== undefined) {
            currentGeneratorState.processedStages = input.processedStages;
        }
        if (input.childResources !== undefined) {
            currentGeneratorState.childResources = input.childResources;
        }
        if (input.resourceStatus !== undefined) {
            currentGeneratorState.resourceStatus = input.resourceStatus;
        }
        if (input.statusDetails) {
            currentGeneratorState.statusDetails = input.statusDetails;
        } else if ((currentGeneratorState as any).status_details) {
            currentGeneratorState.statusDetails = (currentGeneratorState as any).status_details;
            delete (currentGeneratorState as any).status_details;
        }
        if (input.stage) {
            currentGeneratorState.stage = input.stage;
        }
        // need to delete the current state property 'last_updated' if it exists
        // it's a legacy property on the object, so it isn't in the GeneratorState definition
        delete (currentGeneratorState as any).last_updated;

        const updateGeneratorState = async (generatorState: GeneratorState) => {
            if (!generatorState.lastUpdated) {
                generatorState.lastUpdated = Date.now() / 1000;
            }

            await storeProjectData(email, SourceType.GitHub, ownerName, repoName, '', 
                `${resource}/generator`, generatorState);

            if (process.env.TRACE_LEVEL) {
                console.log(`${email} ${req.method} ${req.originalUrl}: Updated Generator: ${JSON.stringify(generatorState)}`);
            }
        };

        // if we're only updating the timestamp on the processing, then don't kick off any new work
        if (forcedUpdate || currentGeneratorState.status === TaskStatus.Processing) {

            console.log(`${email} ${req.method} ${req.originalUrl}: updated processing task: ${JSON.stringify(currentGeneratorState)}`);
            await updateGeneratorState(currentGeneratorState);

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(currentGeneratorState);
        } else {
            // patch is only supported for processing tasks
            return handleErrorResponse(email, new Error(`Invalid PATCH status: ${currentGeneratorState.status}`), req, res, undefined, HTTP_CONFLICT);
        }
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const putOrPostuserProjectDataResourceGenerator = async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return res;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl} Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl} Project is required`);
            }

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const projectData = await loadProjectData(email, org, project);
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        // if we have no resources to generate data from, then we're done
        if (!projectData.resources?.length) {
            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send({
                    status: TaskStatus.Idle,
                    stage: Stages.Complete,
                    lastUpdated: Math.floor(Date.now() / 1000),
                    statusDetails: `No resources to generate data from`,
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
        if (body === '' || body === undefined) {
            console.error(`${email} ${req.method} ${req.originalUrl}: empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        let input : GeneratorState;
        try {
            input = JSON.parse(body);
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack || error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON Body');
        }
        let userGeneratorRequest : GeneratorState = {
            status: input.status
        };
        if (input.stage) {
            userGeneratorRequest.stage = input.stage;
        }

        const updateGeneratorState = async (generatorState: GeneratorState) => {
            if (!generatorState.lastUpdated) {
                generatorState.lastUpdated = Date.now() / 1000;
            }

            if (generatorState.status === TaskStatus.Idle && generatorState.stage === Stages.Complete) {
                generatorState.possibleStagesRemaining = 0;
            }

            const thisGeneratorUri = req.originalUrl.substring(req.originalUrl.indexOf("user_project"));
            const thusGeneratorUriWithForcedUpdate = `${thisGeneratorUri}?force`;
            try {
                await localSelfDispatch<void>(email!, "", req, thusGeneratorUriWithForcedUpdate, 'PATCH', generatorState);
            } catch (error: any) {
                // if the generator state didn't exist, then we'll create it
                if ((error.response && error.response.status === HTTP_FAILURE_NOT_FOUND) ||
                    error.code === HTTP_FAILURE_NOT_FOUND.toString()) {
                    await storeProjectData(email, SourceType.GitHub, ownerName, repoName, '', `${resource}/generator`, generatorState);
                } else {
                    if (error.response) {
                        console.error(`${email} ${req.method} ${req.originalUrl}: Unable to update generator state: `, error.response.data.body || error.response.data);
                    } else {
                        console.error(`${email} ${req.method} ${req.originalUrl}: Unable to update generator state: `, error.stack || error);
                    }
                }
            }

            if (process.env.TRACE_LEVEL) {
                console.log(`${email} ${req.method} ${req.originalUrl}: stored new state: ${JSON.stringify(generatorState)}`);
            }

            if (generatorState.status === TaskStatus.Processing) {
                // if we're still processing, then we'll skip a full project refresh and resource upload
                //  and wait for a terminal state - complete/idle or error

                // unless we have processed a significant batch of updates (stages) - meaning the stages processed is a multiple of the batch size
                const refreshAIFileOnBatchSizeProcessed = 25;
                if (generatorState.processedStages && generatorState.processedStages >= refreshAIFileOnBatchSizeProcessed &&
                    generatorState.processedStages % refreshAIFileOnBatchSizeProcessed === 0) {
                    console.info(`${email} ${req.method} ${req.originalUrl}: Refreshing AI File on Batch Size (${refreshAIFileOnBatchSizeProcessed}) Processed: ${generatorState.processedStages} already processed`);
                } else {
                    return;
                }
            } else if (generatorState.status === TaskStatus.Idle && generatorState.stage !== Stages.Complete) {
                // if we're idle, but not complete, then we'll skip a full project refresh and resource upload
                return;
            }

            // we have completed all stages or reached a terminal point (e.g. error or non-active updating)
            if (generatorState.status === TaskStatus.Idle && generatorState.stage === Stages.Complete) {
                console.debug(`${email} ${req.method} ${req.originalUrl} Completed all ${resource} stages`);
            } else if (generatorState.status === TaskStatus.Error) {
                console.debug(`${email} ${req.method} ${req.originalUrl} Generator errored out: ${generatorState.statusDetails}`);
            } else if (generatorState.status === TaskStatus.Processing) {
                console.debug(`${email} ${req.method} ${req.originalUrl} Incremental File Refresh mid-processing: ${generatorState.statusDetails}`);
            }

            // upload what resources we have to the AI servers
            // this is all an async process (we don't wait for it to complete)
            try {
                await localSelfDispatch<ProjectDataReference[]>(email!, getSignedIdentityFromHeader(req)!, req,
                    `user_project/${org}/${project}/data_references`, 'PUT', undefined, millisecondsBeforeRestRequestMicroTimeout, false);
            } catch (error: any) {
                if (axios.isAxiosError(error) && error.response) {
                    switch (error.response?.status) {
                        case HTTP_FAILURE_NOT_FOUND:
                            console.debug(`${email} ${req.method} ${req.originalUrl} Unable to upload data references to AI Servers for ${org}/${project} - Project Not Found`);
                            break;
                        default:
                            const errorMessage = error.message;
                            const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';
        
                            console.error(`${email} ${req.method} ${req.originalUrl} Unable to upload data references to AI Servers for ${org}/${project} - due to error: ${errorMessage} - ${errorDetails}`);
                    }
                } else {
                    console.error(`${email} ${req.method} ${req.originalUrl} Error uploading data references to AI Servers: `, (error.stack || error));
                }
            }


            // force a refresh of the project status
            const projectStatusRefreshRequest : ProjectStatusState = {
                status: ProjectStatus.Unknown,
                lastUpdated: generatorState.lastUpdated
            };

            // we're going to initialize an async project status refresh (but only wait a few milliseconds to make sure it starts)
            try {
                await localSelfDispatch<ProjectStatusState>(
                    email!, getSignedIdentityFromHeader(req)!, req,
                    `user_project/${org}/${project}/status`, 'PATCH', projectStatusRefreshRequest, millisecondsBeforeRestRequestMicroTimeout, false);
            } catch (error: any) {
                if (error.response) {
                    switch (error.response.status) {
                        case HTTP_FAILURE_NOT_FOUND:
                            console.debug(`${email} ${req.method} ${req.originalUrl} Unable to refresh project status for ${org}/${project} - Project Not Found`);
                            break;
                        default:
                            console.warn(`${email} ${req.method} ${req.originalUrl} Unable to refresh project status for ${org}/${project} - due to error: ${error.response.data.body || error.response.data}`);
                        }
                } else {
                    console.warn(`${email} ${req.method} ${req.originalUrl} Unable to refresh project status for ${org}/${project} - due to error: ${error.stack || error}`);
                }
            }
        };

        try {
            if (userGeneratorRequest.status === TaskStatus.Processing) {

                console.log(`${email} ${req.method} ${req.originalUrl} processing task: ${JSON.stringify(userGeneratorRequest)}`);

                try {
                    // to prevent a runaway generator - where it infinite loops on one stage, or processes too many stages
                    //    e.g. 1000 processing steps per stage for a 3 stage process - with 1000 files... we're going to limit
                    //    the number of processed stages to 2000.
                    // that will ensure a resource with 1000 files, should only process each file once at most.
                    // this counter will reset on error or completion of the generator or generator going idle (meaning a pause in processing)
                    // This is mainly to prevent runaway CPU usage on a single resource
                    const maximumLimitForProcessedStages = 2000;

                    // if we're starting processing - from Idle, Error or Complete, then we'll reset the processed stages
                    // NOTE This means that a runaway generator that keeps reprocessing the same stages or many operations per file
                    //      and periodically goes into an error or idle state - could go beyond the maximum limit
                    // But since a generator in an error or idle or complete state won't automatically restart itself, we assume something
                    //      else started this process, so it isn't a self-perpetuating loop
                    if (currentGeneratorState.status !== TaskStatus.Processing) {
                        currentGeneratorState.processedStages = 0;
                    }

                    if (currentGeneratorState?.processedStages && currentGeneratorState.processedStages > maximumLimitForProcessedStages) {
                        throw new Error(`${email} ${req.method} ${req.originalUrl}  Generator exceeded Processing Limit of ${maximumLimitForProcessedStages} stages - ${currentGeneratorState.processedStages} stages already processed`);
                    } else if (currentGeneratorState?.processedStages) {
                        currentGeneratorState.processedStages++;
                    } else {
                        currentGeneratorState.processedStages = 1;
                    }

                    currentGeneratorState.status = TaskStatus.Processing;
                    currentGeneratorState.lastUpdated = undefined; // get a refreshed last updated timestamp
                    await updateGeneratorState(currentGeneratorState);

                    // if user requested a specific stage, then we'll process that stage
                    //      otherwise, we'll process the current stage in the generator
                    const processNextStageState : ResourceGeneratorProcessState = {
                        stage: userGeneratorRequest.stage?userGeneratorRequest.stage:currentGeneratorState.stage!,
                    };
                    if (typeof processNextStageState.stage !== 'string') {
                        processNextStageState.stage = "";
                    }
                    const pathToProcess = `${req.originalUrl.substring(req.originalUrl.indexOf('user_project'))}/process`;

                    const processStartTime = Math.floor(Date.now() / 1000);

                    const newGeneratorState = await localSelfDispatch<ResourceGeneratorProcessState>(email, "", req, pathToProcess, "POST", processNextStageState.stage?processNextStageState:undefined,
                        secondsBeforeRestRequestMaximumTimeout * 1000, false);
                    const processEndTime = Math.floor(Date.now() / 1000);

                    if (!newGeneratorState?.stage) {
                        throw new Error(`Processor timed out ${processEndTime - processStartTime} sec - ${processNextStageState.stage?processNextStageState.stage:"[Initializing]"} Stage`);
                    } else {
                        if (process.env.TRACE_LEVEL) {
                            console.log(`${email} ${req.method} ${req.originalUrl} TIMECHECK: ${processNextStageState.stage?processNextStageState.stage:"[Initializing]"}: processing started:${processStartTime} ended:${processEndTime} (${processEndTime - processStartTime} seconds) - move to stage: ${currentGeneratorState.stage}`);
                        }
                    }
                    currentGeneratorState.stage = newGeneratorState.stage;

                    // if we've finished all stages, then we'll set the status to complete and idle
                    if (currentGeneratorState.stage === Stages.Complete && currentGeneratorState.status === TaskStatus.Processing) {
                        currentGeneratorState.status = TaskStatus.Idle;
                        const currentDateTime = usFormatter.format(new Date(Date.now()));
                        currentGeneratorState.statusDetails = `Completed all ${resource} stages (${currentGeneratorState.processedStages}) at ${currentDateTime}`;
                    }

                    await updateGeneratorState(currentGeneratorState);
                } catch (error: any) {
                    console.error(`${email} ${req.method} ${req.originalUrl} Error processing stage ${currentGeneratorState.stage?currentGeneratorState.stage:"[Initializing]"}:`, error);

                    if (error instanceof GeneratorProcessingError) {
                        const processingError = error as GeneratorProcessingError;
                        if (processingError.stage != currentGeneratorState.stage) {
                            console.error(`${email} ${req.method} ${req.originalUrl} Resetting to ${processingError.stage} due to error in ${resource} stage ${currentGeneratorState.stage}:`, processingError);

                            currentGeneratorState.statusDetails = `Resetting to earlier stage ${processingError.stage} due to error: ${processingError}`;
                        } else {
                            currentGeneratorState.statusDetails = `Rerun current stage due to error: ${processingError}`;
                        }
                    } else {
                        if (axios.isAxiosError(error)) {
                            const errorMessage = error.message;
                            const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';                        
                            currentGeneratorState.statusDetails = `${error.response?.status}:${error.response?.statusText} due to error: ${errorMessage} - Details: ${errorDetails}`;
                        } else {
                            currentGeneratorState.statusDetails = `${JSON.stringify(error.stack || error)}`;
                        }
                    }

                    // In case of error, set status to error
                    currentGeneratorState.status = TaskStatus.Error;
                    currentGeneratorState.lastUpdated = undefined; // get a refreshed last updated timestamp

                    await updateGeneratorState(currentGeneratorState);

                    // we errored out, so we'll return an error HTTP status code for operation failed, may need to retry
                    return handleErrorResponse(email, error, req, res);
                }

                // if we're processing and not yet completed the full stages, then we need to process the next stage
                if (currentGeneratorState.status === TaskStatus.Processing && currentGeneratorState.stage !== Stages.Complete) {
                    // we need to terminate the current call so we don't create a long blocking HTTP call
                    //      so we'll start a new async HTTP request - detached from the caller to continue processing
                    //      the next stage
                    if (process.env.TRACE_LEVEL) {
                        console.log(`${email} ${req.method} ${req.originalUrl} starting async processing for ${JSON.stringify(currentGeneratorState)}`);
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
                    const thisEndpointPath = req.originalUrl.substring(req.originalUrl.indexOf('user_project'));

                    try {
                        const nextGeneratorStageCallState : GeneratorState =
                            await localSelfDispatch<GeneratorState>(email, "", req, thisEndpointPath,
                                "PUT", newProcessingRequest, 1000, false);
                        if (Object.keys(nextGeneratorStageCallState).length === 0) {
                            // if we timed out waiting for the response, then we'll just keep going assuming the async call will update
                            //      the generator state as needed
                        }
                    } catch (error: any) {
                        let errorMessage = `${JSON.stringify(error.stack || error)}`;
                        if (axios.isAxiosError(error) && error.response) {
                            const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';
                            errorMessage = `${error.response.status}:${error.response.statusText} due to error: ${error.message} - Details: ${errorDetails}`;
                        }
                        currentGeneratorState.status = TaskStatus.Error;
                        currentGeneratorState.statusDetails = `Error starting next stage to process: ${errorMessage}`;

                        await updateGeneratorState(currentGeneratorState);

                        // we errored out, so we'll return an error HTTP status code for operation failed, may need to retry
                        return handleErrorResponse(email, error, req, res, `Error starting next stage to process`);
                    }

                    // Return a response immediately without waiting for the async process
                    return res
                        .status(HTTP_SUCCESS_ACCEPTED)
                        .contentType('application/json')
                        .send(currentGeneratorState);
                }
            } else if (userGeneratorRequest.status === TaskStatus.Idle) {
                if (process.env.TRACE_LEVEL) {
                    console.log(`${email} ${req.method} ${req.originalUrl} idle task: ${JSON.stringify(userGeneratorRequest)}`);
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
                        currentGeneratorState.statusDetails = `Idle due to inactivity for ${MinutesToWaitBeforeGeneratorConsideredStalled} minutes`;
                        await updateGeneratorState(currentGeneratorState);
                    }
                }
            } else if (userGeneratorRequest.status === TaskStatus.Error) {
                // external caller can't set the status to error, so we'll return bad input HTTP status code
                console.error(`${email} ${req.method} ${req.originalUrl} Invalid input status: ${userGeneratorRequest.status}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send();
            } else {
                // external caller can't set the status to unknown, so we'll return bad input HTTP status code
                console.error(`${email} ${req.method} ${req.originalUrl} Invalid input status: ${userGeneratorRequest.status}`);
                return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send();
            }
        } catch (error) {
            return handleErrorResponse(email, error, req, res, `Unable to handle task request`);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(currentGeneratorState);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
};

app.route(`${api_root_endpoint}/${user_project_org_project_data_resource_generator}`)
   .post(putOrPostuserProjectDataResourceGenerator)
   .put(putOrPostuserProjectDataResourceGenerator);

async function processStage(serviceEndpoint: string, email: string, project: UserProjectData, resource: string, stage?: string, forceProcessing: boolean = false) {
    
    if (stage) {
        console.log(`${email} ${project.org}:${project.name}:${resource} Processing stage ${stage}...`);
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
    thisGenerator.forceProcessing = forceProcessing;
    return await thisGenerator.generate(stage);
}

interface ResourceGeneratorProcessState {
    stage: string;
    forceProcessing?: boolean;
}

const user_project_org_project_data_resource_generator_process = `${user_project_org_project_data_resource_generator}/process`;
app.post(`${api_root_endpoint}/${user_project_org_project_data_resource_generator_process}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return res;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl} Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl} Project is required`);
            }

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }
        const { _, __, resource } = req.params;
        if (!resource) {
            console.error(`${email} ${req.method} ${req.originalUrl} Resource is required`);
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
                } catch (error: any) {
                    console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack || error);
                    return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON Body');
                }

                resourceGeneratorProcessState = {
                    stage: input.stage
                };
                if (input.forceProcessing) {
                    resourceGeneratorProcessState.forceProcessing = input.forceProcessing;
                }
            }
        }

        const projectData = await loadProjectData(email, org, project);
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        // Launch the processing task
        let selfEndpoint = `${req.protocol}://${req.get('host')}`;
        // if we're running locally, then we'll use http:// no matter what
        if (req.get('host')!.includes('localhost')) {
            selfEndpoint = `http://${req.get('host')}`;
        }

        try {
            const nextStage : string = await processStage(selfEndpoint, email, projectData, resource, resourceGeneratorProcessState?.stage, resourceGeneratorProcessState?.forceProcessing);
            const nextGeneratorState : ResourceGeneratorProcessState = {
                stage: nextStage
            };
            if (process.env.TRACE_LEVEL) {
                console.log(`${email} ${req.method} ${req.originalUrl} Completed stage ${nextStage}`);
            }

            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(nextGeneratorState);
        } catch (error: any) {

            let currentStage = resourceGeneratorProcessState?.stage;
            if (!currentStage) {
                currentStage = "[Current Stage]";
            }

            if (error instanceof GeneratorProcessingError) {
                const processingError = error as GeneratorProcessingError;
                if (processingError.stage != currentStage) {
                    console.error(`${email} ${req.method} ${req.originalUrl} Resetting to ${processingError.stage} due to error in ${resource} stage ${currentStage}:`, (processingError.stack || processingError));
            
                    const nextGeneratorState : ResourceGeneratorProcessState = {
                        stage: processingError.stage
                    };
        
                    return res
                        .status(HTTP_SUCCESS)
                        .contentType('application/json')
                        .send(nextGeneratorState);
                }
            }

            console.error(`${email} ${req.method} ${req.originalUrl} Error processing stage ${currentStage}:`, (error.stack || error));

            throw error;
        }
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const user_project_org_project_data_references = `${user_project_org_project}/data_references`;
const postUserProjectDataReferences = async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                console.error(`${email} ${req.method} ${req.originalUrl} Org is required`);
            } else if (!project) {
                console.error(`${email} ${req.method} ${req.originalUrl} Project is required`);
            }

            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid resource path');
        }

        const userProjectData = await loadProjectData(email, org, project);
        if (!userProjectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        if (!userProjectData.resources || userProjectData.resources.length === 0) {
            console.warn(`${email} ${req.method} ${req.originalUrl} No resources found in project`);

            // we reset the project data references to empty - since we have no resources to upload, and we want to update the cache
            const emptyProjectDataFileIds: ProjectDataReference[] = [];
            await storeProjectData(email, SourceType.General, userProjectData.org, userProjectData.name, '', 'data_references', emptyProjectDataFileIds);

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
            console.error(`${email} ${req.method} ${req.originalUrl} Invalid URI: ${repoUri}`);
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
                let resourceData = await getCachedProjectData<string>(email, SourceType.GitHub, ownerName, repoName, "", projectDataTypes[i], false);
                if (!resourceData) {
                    if (process.env.TRACE_LEVEL) {
                        console.log(`${email} ${req.method} ${req.originalUrl} no data found for ${projectDataTypes[i]}`);
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
                        const timeBeforeOpenAICall = Date.now();
                        let needsRefresh : boolean = existingProjectFileIds.get(projectDataTypes[i])?.id === undefined;
                        if (!needsRefresh) {
                            // the resource upload looks like it's newer than the resource status - but we need to verify the uploaded
                            //      file still exists
                            const existingFile : OpenAIFile | undefined = await getOpenAIFile(existingProjectFileIds.get(projectDataTypes[i])?.id!);
                            if (!existingFile) {
                                console.debug(`${email} ${req.method} ${req.originalUrl} Existing Project AI File ${projectDataTypes[i]} ${existingProjectFileIds.get(projectDataTypes[i])?.id} not found - needs refresh`);
                                needsRefresh = true;
                            }
                        }

                        if (!needsRefresh) {
                            const timeRemainingFromOneSecondThrottle = 1000 - (Date.now() - timeBeforeOpenAICall);
                            // only need throttling delay for non-last resource
                            if (timeRemainingFromOneSecondThrottle > 0 && i < projectDataTypes.length - 1) {
                                await delay(timeRemainingFromOneSecondThrottle);
                            }
                            console.debug(`${email} ${req.method} ${req.originalUrl}: Skipping upload of ${projectDataTypes[i]} - likely uploaded at ${usFormatter.format(lastUploadedDate)} and resource updated at ${usFormatter.format(resourceStatusDate)}`);
                            continue;
                        }
                    }

                    if (lastUploaded) {
                        console.debug(`${email} ${req.method} ${req.originalUrl}: Uploading ${projectDataTypes[i]} (${resourceData.length} bytes) from ${usFormatter.format(resourceStatusDate)}: ${timeDifferenceInSeconds} seconds out of sync; last uploaded at ${usFormatter.format(lastUploadedDate)}`);
                    } else {
                        console.debug(`${email} ${req.method} ${req.originalUrl}: Uploading ${projectDataTypes[i]} (${resourceData.length} bytes) from ${usFormatter.format(resourceStatusDate)}: never uploaded`);
                    }
                } catch (error) {
                    console.error(`${email} ${req.method} ${req.originalUrl} Uploading ${projectDataTypes[i]} (${resourceData.length} bytes) due to error checking last upload time: `, error);
                }
                
                if (process.env.TRACE_LEVEL) {
                    console.log(`${email} ${req.method} ${req.originalUrl} retrieved project data for ${projectDataTypes[i]}`);
                }

                try {

                    const timeBeforeOpenAICall = Date.now();
                    const storedProjectDataId = await uploadProjectDataForAIAssistant(email, userProjectData.org, userProjectData.name, repoUri, projectDataTypes[i], projectDataNames[i], resourceData);
                    if (process.env.TRACE_LEVEL) {
                        console.log(`${email} ${req.method} ${req.originalUrl} found File Id for ${projectDataTypes[i]} under ${projectDataNames[i]}: ${JSON.stringify(storedProjectDataId)}`);
                    }
                    console.debug(`${email} ${req.method} ${req.originalUrl} Uploaded ${storedProjectDataId.id} - ${projectDataTypes[i]} (${resourceData.length} bytes) to AI Servers in ${Date.now() - timeBeforeOpenAICall} ms`);
                    refreshedProjectData = true;

                    // update the existing resources with the newly uploaded info
                    const previousProjectFileId = existingProjectFileIds.get(projectDataTypes[i])?.id;
                    if (previousProjectFileId) {
                        const timeRemainingFromOneSecondThrottle = 1000 - (Date.now() - timeBeforeOpenAICall);
                        if (timeRemainingFromOneSecondThrottle > 0) {
                            await delay(timeRemainingFromOneSecondThrottle);
                        }
                        try {
                            await deleteAssistantFile(previousProjectFileId);
                            console.debug(`${email} ${req.method} ${req.originalUrl} Deleted previous Project File Resource ${projectDataTypes[i]} ${previousProjectFileId}`);
                        } catch (error: any) { // we're going to ignore failure to delete and keep going... auto groomer will cleanup later
                            console.error(`${email} ${req.method} ${req.originalUrl} Unable to delete previous Project File Resource ${projectDataTypes[i]} ${previousProjectFileId}:`, error.message);
                        }
                    }
                    existingProjectFileIds.set(projectDataTypes[i], storedProjectDataId);

                } catch (error: any) {
                    if (error.message?.includes("exceeded")) {
                        // If rate limit exceeded error is detected, fail immediately - don't continue AI uploads
                        return handleErrorResponse(email, error, req, res, `Rate Limit Exceeded: ${error}`);
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
            return handleErrorResponse(email, error, req, res, `Unable to retrieve project data`);
        }

        if (missingDataTypes.length > 0) {
            if (missingDataTypes.length < projectDataTypes.length) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Missing data for ${missingDataTypes.join(", ")}`);
            } else {
                return res.status(HTTP_SUCCESS_NO_CONTENT).send(`No data found for ${missingDataTypes.join(", ")}`);
            }
        }

        if (uploadFailures.size > 0) {
            // Convert Map keys and values to arrays for processing
            const failedKeys = Array.from(uploadFailures.keys());
            const failedValues = Array.from(uploadFailures.values());
            if (uploadFailures.size < projectDataTypes.length) {
                console.warn(`${email} ${req.method} ${req.originalUrl} Failed to upload data for ${failedKeys.join(", ")}`);
            } else {
                // Handle the first error specifically
                return handleErrorResponse(email, failedValues[0], req, res, `Unable to store project data on AI Servers:`);
            }
        }

        // extract the file ids from the map (previous and any updated)
        const projectDataFileIds = Array.from(existingProjectFileIds.values());

        if (refreshedProjectData) {
            await storeProjectData(email, SourceType.General, userProjectData.org, userProjectData.name, '', 'data_references', projectDataFileIds);

            // now refresh project status since we've completed uploads
            const projectStatusRefreshRequest : ProjectStatusState = {
                status: ProjectStatus.Unknown,
                lastUpdated: Date.now() / 1000
            };
            try {
                await localSelfDispatch<ProjectStatusState>(
                    email, getSignedIdentityFromHeader(req)!, req,
                    `user_project/${org}/${project}/status`, 'PATCH', projectStatusRefreshRequest, millisecondsBeforeRestRequestMicroTimeout, false);

            } catch (error: any) {
                if ((error.response && error.response.status === HTTP_FAILURE_NOT_FOUND) ||
                    (error.code === HTTP_FAILURE_NOT_FOUND.toString())) {
                    // since we may not have status available yet to PATCH - ignore status missing
                } else {
                    throw error;
                }
            }
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(projectDataFileIds);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
};

app.route(`${api_root_endpoint}/${user_project_org_project_data_references}`)
   .post(postUserProjectDataReferences)
   .put(postUserProjectDataReferences);

app.get(`${api_root_endpoint}/${user_project_org_project_data_references}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const projectData = await loadProjectData(email, org, project);
        if (!projectData) {
            return res.status(HTTP_FAILURE_NOT_FOUND).send('Project not found');
        }

        if (!projectData.resources || projectData.resources.length === 0) {
            console.error(`${email} ${req.method} ${req.originalUrl} No resources found in project`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('No resources found in project');
        }

        const dataReferencesRaw : any = await getProjectData(email, SourceType.General, projectData.org, projectData.name, '', 'data_references');
        if (!dataReferencesRaw) {
            console.warn(`${email} ${req.method} ${req.originalUrl} No data references found in project`);

            // return an empty array if no data references found
            return res
                .status(HTTP_SUCCESS_NO_CONTENT)
                .contentType('application/json')
                .send([]);
        }
        const dataReferences = JSON.parse(dataReferencesRaw) as ProjectDataReference[];

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(dataReferences);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_project_org_project_data_references}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { org, project } = req.params;
        if (!org || !project) {
            if (!org) {
                return handleErrorResponse(email, new Error("Org is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error("Project is required"), req, res, "Invalid resource path", HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const dataReferencesRaw = await getProjectData(email, SourceType.General, org, project, '', 'data_references');
        if (!dataReferencesRaw) {

            console.warn(`${email} ${req.method} ${req.originalUrl}  No data references found for DELETE`);

        } else {
            const dataReferences = JSON.parse(dataReferencesRaw) as ProjectDataReference[];
            for (let i = 0; i < dataReferences.length; i++) {
                if (dataReferences[i].id.includes('simulate')) {
                    console.warn(`${email} ${req.method} ${req.originalUrl}  Skipping deletion of simulate data: ${dataReferences[i].name}`);
                    continue;
                }
                try {
                    await deleteAssistantFile(dataReferences[i].id);
                } catch (error: any) {
                    console.warn(`${email} ${req.method} ${req.originalUrl} Error deleting file ${dataReferences[i].id}:`, error.stack || error);
                }
            }

            await deleteProjectData(email, SourceType.General, org, project, '', 'data_references');
        }

        return res
            .status(HTTP_SUCCESS)
            .send();
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const files_source_owner_project_path_analysisType = `files/:source/:owner/:project/:pathBase64/:analysisType`;
app.delete(`${api_root_endpoint}/${files_source_owner_project_path_analysisType}`, async (req, res) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { source, owner, project, pathBase64, analysisType } = req.params;

        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            if (!source) {
                return handleErrorResponse(email, new Error('Source is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!owner) {
                return handleErrorResponse(email, new Error('Owner is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!project) {
                return handleErrorResponse(email, new Error('Project is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!pathBase64) {
                return handleErrorResponse(email, new Error('Path is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!analysisType) {
                return handleErrorResponse(email, new Error('Analysis type is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error('Invalid resource path'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            return handleErrorResponse(email, error, req, res, `Error decoding path: ${pathBase64}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        await deleteProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType);

        return res
            .status(HTTP_SUCCESS)
            .send();

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.get(`${api_root_endpoint}/${files_source_owner_project_path_analysisType}`, async (req, res) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const { source, owner, project, pathBase64, analysisType } = req.params;

        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            if (!source) {
                return handleErrorResponse(email, new Error('Source is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!owner) {
                return handleErrorResponse(email, new Error('Owner is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!project) {
                return handleErrorResponse(email, new Error('Project is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!pathBase64) {
                return handleErrorResponse(email, new Error('Path is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!analysisType) {
                return handleErrorResponse(email, new Error('Analysis type is required'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            return handleErrorResponse(email, new Error('Invalid resource path'), req, res, 'Invalid resource path', HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            return handleErrorResponse(email, error, req, res, `Error decoding path: ${pathBase64}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const data = await getProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType);
        if (!data) {
            return handleErrorResponse(email, new Error('Resource not found'), req, res, `Resource not found`, HTTP_FAILURE_NOT_FOUND);
        }

        return res.status(HTTP_SUCCESS).contentType('text/plain').send(data);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.post(`${api_root_endpoint}/${files_source_owner_project_path_analysisType}`, async (req, res) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
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
            return handleErrorResponse(email, error, req, res, `Error decoding path: ${pathBase64}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const data = req.body; // Assuming data is sent directly in the body
        if (!data) {
            return handleErrorResponse(email, new Error('No data provided'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        await storeProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType, data, false);
        res.sendStatus(HTTP_SUCCESS);

    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const proxy_ai_endpoint = "proxy/ai/:org/:endpoint";
const handleProxyRequest = async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        const org = req.params.org;
        const endpoint = req.params.endpoint;

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        if (!org) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        } else if (!endpoint) {
            return handleErrorResponse(email, new Error('Endpoint is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
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
                console.log(`[Proxy] ${externalEndpoint} Proxy response: ${response.status} ${response.statusText} (${(endTimeOfCall - startTimeOfCall) / 1000} seconds)`);
            }

            return res
                .status(response.status)
                .contentType('application/json')
                .send(response.data);
        } catch (error: any) {
            const endTimeOfCallError = Date.now();
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                    console.error(`${email} ${req.method} ${req.originalUrl} TIMEOUT: Request to ${externalEndpoint} timed out after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error.stack || error);
                } else if (error.code === 'ECONNREFUSED') {
                    let errorMessage;
                    if (error.message.includes('localhost') || error.message.includes('::1')) {
                        errorMessage = `Connection refused to ${externalEndpoint} - is the local server running?`;
                    } else {
                        errorMessage = `Connection refused to ${externalEndpoint} - is the external service running?`;
                    }
                    return handleErrorResponse(email, error, req, res, errorMessage, HTTP_FAILURE_SERVICE_UNAVAILABLE);
                } else if (error.response) {
                    const errorMessage = error.message;
                    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No additional error information';
                    console.error(`${email} ${req.method} ${req.originalUrl}Server responded with status ${error.response.status} ${error.response.statusText} - ${errorMessage} - ${errorDetails} after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error.stack || error);
                    return res.status(error.response.status).send(error.response.statusText);
                } else if (error.request) {
                    console.error(`${email} ${req.method} ${req.originalUrl} No response received from ${externalEndpoint} after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error.stack || error);
                } else {
                    console.error(`${email} ${req.method} ${req.originalUrl} Request setup failed for ${externalEndpoint} after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error.stack || error);
                }
            } else {
                console.error(`${email} ${req.method} ${req.originalUrl} Unknown error during proxy request for ${externalEndpoint} after ${(endTimeOfCallError - startTimeOfCall) / 1000} seconds`, error.stack || error);
            }
            return res.status(HTTP_FAILURE_INTERNAL_SERVER_ERROR).send('Internal Server Error');
        }
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
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
    email: string,
    billingUrl: string,
    githubUsername: string,
    backgroundAnalysisAuthorized: boolean,
    details: string,
    lastUpdated: number,
};

const user_org_account = `user/:org/account`;

app.patch(`${api_root_endpoint}/${user_org_account}`, async (req, res) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        // for updating the username, we don't need the org, since the username is tied back to the email address
        const org = req.params.org;
        if (!org) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let body = req.body;
        if (!body) {
            console.error(`${email} ${req.method} ${req.originalUrl} empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        if (typeof body !== 'string') {
            if (Buffer.isBuffer(body) || Array.isArray(body)) {
                body = Buffer.from(body).toString('utf8');
            } else {
                body = JSON.stringify(body);
            }
        }

        if (body === undefined || body === '') {
            console.error(`${email} ${req.method} ${req.originalUrl} empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }
        let requestedUserAccountState: UserAccountState;
        try {
            requestedUserAccountState = JSON.parse(body) as UserAccountState;
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Error parsing JSON ${JSON.stringify(body)}: `, error.stack || error);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Invalid JSON');
        }
        if (Object.keys(requestedUserAccountState).length === 0) {
            console.error(`${email} ${req.method} ${req.originalUrl} empty body`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing body');
        }

        if (requestedUserAccountState.githubUsername !== undefined && requestedUserAccountState.githubUsername !== '') {
            const existingUser = await getUser(email);
            if (existingUser && existingUser.username === requestedUserAccountState.githubUsername) {
                console.debug(`${email} ${req.method} ${req.originalUrl} [SaraLogin] No change in username`);
            } else {
                await saveUser(email, requestedUserAccountState.githubUsername,
                    // StephenAFisher Added Username via Sara/REST-API at March 25, 2024 at 02:21:49 AM
                    `${requestedUserAccountState.githubUsername} [SaraLogin] Added Username via Sara/REST-API at ${usFormatter.format(new Date())}`);
            }
        } else {
            console.error(`${email} ${req.method} ${req.originalUrl} Missing github username`);
            return res.status(HTTP_FAILURE_BAD_REQUEST_INPUT).send('Missing github username');
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(requestedUserAccountState);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.get(`${api_root_endpoint}/${user_org_account}`, async (req, res) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        // don't create the account if we are in verify only mode
        // const verifyOnly = (req.query.verifyOnly !== undefined)?true:false;
        const verifyOnly = false;

        const signedIdentity = getSignedIdentityFromHeader(req);
        if (!signedIdentity) {
            console.error(`${email} ${req.method} ${req.originalUrl} Missing signed identity - after User Validation passed`);
            return res
                .status(HTTP_FAILURE_UNAUTHORIZED)
                .send('Unauthorized');
        }

        const org = req.params.org;
        if (!org) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const accountStatus = await localSelfDispatch<UserAccountState>(email, signedIdentity, req, `proxy/ai/${org}/${Services.CustomerPortal}${verifyOnly?'?verifyOnly':''}`, "GET");
        // remap the billing url from the billing field name - portal_url
        accountStatus.billingUrl = (accountStatus as any).portal_url || '';
        delete (accountStatus as any).portal_url;

        const user = await getUser(email);
        accountStatus.githubUsername = user?.username || '';

        accountStatus.backgroundAnalysisAuthorized = (user?.installationId !== undefined && user?.installationId !== '');

        accountStatus.details = user?.details || `User Account retrieved at ${usFormatter.format(new Date())}`;

        accountStatus.lastUpdated = user?.lastUpdated || (Date.now() / 1000);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(accountStatus);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

interface OrgAccountState {
    enabled: boolean,
    status: string,
    plan: string,
    billingUrl: string,
    adminUsername: string,
    backgroundAnalysisAuthorized: boolean,
    details: string,
    lastUpdated: number,
};

const org_org_account = `org/:org/account`;
app.get(`${api_root_endpoint}/${org_org_account}`, async (req, res) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const org = req.params.org;
        if (!org) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const orgId = await getUser(org);

        // we don't yet have a clean way to lookup the org payment plan, so we'll return Org app data only
        // const userAccountStatus = await localSelfDispatch<UserAccountState>(email, getSignedIdentityFromHeader(req)!, req, `user/${org}/account?verifyOnly`, 'GET');

        const orgAccountState : OrgAccountState = {
            enabled: orgId?.username !== undefined,
            //status: userAccountStatus.status,
            status: orgId?.username !== undefined?'trial':'free',
            // plan: userAccountStatus.plan,
            plan: 'free',
            // remap the billing url from the billing field name - portal_url
            // billingUrl: (userAccountStatus as any).portal_url,
            billingUrl: '',
            // remap the github username from the user account status
            adminUsername: (orgId?.admin !== undefined)?orgId.admin:'',
            details: orgId?.details || `Org Account retrieved at ${usFormatter.format(new Date())}`,
            lastUpdated: orgId?.lastUpdated || (Date.now() / 1000),
            backgroundAnalysisAuthorized: (orgId?.installationId !== undefined && orgId?.installationId !== ''),
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(orgAccountState);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_profile = `user/profile`;
app.delete(`${api_root_endpoint}/${user_profile}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        await deleteProjectData(email, SourceType.General, 'user', '', '', 'profile');
        if (process.env.TRACE_LEVEL) {
            console.log(`${email} ${req.method} ${req.originalUrl} deleted data`);
        }

        return res
            .status(HTTP_SUCCESS)
            .send();
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

interface UserProfile {
    name?: string,
    title?: string,
    details?: string,
    aiData?: string,
    lastUpdated?: number,
};

app.put(`${api_root_endpoint}/${user_profile}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
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
        if (body === '' || body === undefined) {
            return handleErrorResponse(email, new Error('Missing body'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let newProfileData : UserProfile;
        try {
            newProfileData = JSON.parse(body) as UserProfile;
        } catch (error: any) {
            return handleErrorResponse(email, error, req, res, `Error parsing profile data ${JSON.stringify(body)}: ${JSON.stringify(error.stack || error)}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const profileData: UserProfile = {};
        if (newProfileData.name) {
            profileData.name = newProfileData.name;
        }
        if (newProfileData.title) {
            profileData.title = newProfileData.title;
        }
        if (newProfileData.details) {
            profileData.details = newProfileData.details;
        }
        if (newProfileData.aiData) {
            profileData.aiData = newProfileData.aiData;
        }
        newProfileData.lastUpdated = Date.now() / 1000;
        await storeProjectData(email, SourceType.General, 'user', '', '', 'profile', profileData);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(profileData);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.patch(`${api_root_endpoint}/${user_profile}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
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
        if (body === '' || body === undefined) {
            return handleErrorResponse(email, new Error('Missing body'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        let newProfileData : UserProfile;
        try {
            newProfileData = JSON.parse(body) as UserProfile;
        } catch (error: any) {
            return handleErrorResponse(email, error, req, res, `Error parsing profile data ${JSON.stringify(body)}: ${JSON.stringify(error.stack || error)}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const profileDataRaw = await getProjectData(email, SourceType.General, 'user', '', '', 'profile');
        let profileData: UserProfile = {};
        if (profileDataRaw) {
            profileData = JSON.parse(profileDataRaw) as UserProfile;
        }

        if (newProfileData.name) {
            profileData.name = newProfileData.name;
        }
        if (newProfileData.title) {
            profileData.title = newProfileData.title;
        }
        if (newProfileData.details) {
            profileData.details = newProfileData.details;
        }
        if (newProfileData.aiData) {
            profileData.aiData = newProfileData.aiData;
        }
        profileData.lastUpdated = Date.now() / 1000;

        await storeProjectData(email, SourceType.General, 'user', '', '', 'profile', profileData);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(profileData);
        
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.get(`${api_root_endpoint}/${user_profile}`, async (req: Request, res: Response) => {

    let email : string | undefined = undefined;
    try {

        email = await validateUser(req, res);
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
        return handleErrorResponse(email, error, req, res);
    }
});

interface ServiceStatusState {
    version: string;
    status: string;
    type: string
}

const api_status = `status`;
app.get(`${api_root_endpoint}/${api_status}`, async (req: Request, res: Response) => {

    logRequest(req, "");

    try {
        // get the version from the environment variable APP_VERSION
        const version = process.env.APP_VERSION;
        if (!version) {
            return handleErrorResponse(undefined, new Error('Missing APP_VERSION environment variable'), req, res);
        }
        const type = process.env.DEPLOYMENT_STAGE;
        if (!type) {
            return handleErrorResponse(undefined, new Error('Missing DEPLOYMENT_STAGE environment variable'), req, res);
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
        return handleErrorResponse(undefined, error, req, res);
    }
});

const DefaultGroomingIntervalInMinutes = 5;

let existingInterval : NodeJS.Timeout | undefined = undefined;
const api_timer_config = `timer/config`;
app.post(`${api_root_endpoint}/${api_timer_config}`, async (req: Request, res: Response, next) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res, AuthType.Admin);
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
                return handleErrorResponse(email, error, req, res, `Invalid grooming interval: ${body}`, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
        }

        // Timer API request function
        const callTimerAPI = async () => {
            try {
                const identityHeader = await signedAuthHeader(local_sys_admin_email)
                const data = await localSelfDispatch<string>("", identityHeader[header_X_Signed_Identity], req, `timer/interval`, "POST");
                console.log(`${email} ${req.method} ${req.originalUrl} Timer API response: ${data}`)
            } catch (error: any) {
                console.error(`${email} ${req.method} ${req.originalUrl} Error calling Timer API:`, error.stack || error);
            }
        };

        if (!process.env.IS_OFFLINE) {
            // if we're in AWS - and not running offline - then fail this call with a HTTP_FAILURE_BAD_REQUEST_INPUT
            return handleErrorResponse(email, new Error('Timer API configuration not supported in AWS'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
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
            console.log(`${email} ${req.method} ${req.originalUrl} Clearing existing Timer API interval`);
            clearInterval(existingInterval!);
        }

        if (groomingInterval === 0) {
            console.log(`${email} ${req.method} ${req.originalUrl} Timer API interval disabled`);
        } else {
            console.log(`${email} ${req.method} ${req.originalUrl} Setting Timer API interval to ${groomingInterval} seconds`)
            existingInterval = setInterval(callTimerAPI, groomingInterval * milliseconds);
        }
        
        // return the new timer interval
        return res
            .status(HTTP_SUCCESS)
            .contentType("application/json")
            .send(groomingInterval.toString());
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const api_timer_interval = `timer/interval`;
app.post(`${api_root_endpoint}/${api_timer_interval}`, async (req: Request, res: Response, next) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res, AuthType.Admin);
        if (!email) {
            return;
        }

        const currentTimeinSeconds = Math.floor(Date.now() / 1000);

        // run the project groomer
        const originalIdentity = getSignedIdentityFromHeader(req);
        if (!originalIdentity) {
            return handleErrorResponse(email, new Error('Missing signed identity - after User Validation passed'), req, res, undefined, HTTP_FAILURE_UNAUTHORIZED);
        }

        try {
            // async launch of groom projects process
            await localSelfDispatch<void>("", originalIdentity, req, groom_projects, "POST", undefined, 0, false);
        } catch (error: any) {
            console.error(`${email} ${req.method} ${req.originalUrl} Timer Triggered: Error starting async groom projects process: `, error.stack || error);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType("text/plain")
            .send(`Timer HTTP POST Ack: ${currentTimeinSeconds}`);
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_org_connectors_openai_files = `user/:org/connectors/openai/files`;
app.get(`${api_root_endpoint}/${user_org_connectors_openai_files}`, async (req: Request, res: Response, next) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const org = req.params.org;
        if (!org) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const project = typeof req.query.project === 'string' ? req.query.project : undefined;
        const dataType = typeof req.query.dataType === 'string' ? req.query.dataType : undefined;
        let repoUri = undefined;
        if (project) {
            const projectData = await loadProjectData(email, org, project);
            if (!projectData) {
                console.warn(`${email} ${req.method} ${req.originalUrl}  Project not found: ${org}/${project} - cannot filter on repos`);
            } else if (projectData.resources &&
                projectData.resources.length > 0) {
                repoUri = new URL(projectData.resources[0].uri);
            }
        }

        const aiFiles : OpenAIFile[] = await searchOpenAIFiles({ email, org, project, repoUri, dataType});

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(aiFiles);
            
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_org_connectors_openai_assistants = `user/:org/connectors/openai/assistants`;
app.get(`${api_root_endpoint}/${user_org_connectors_openai_assistants}`, async (req: Request, res: Response, next) => {

    let email : string | undefined = undefined;
    try {
        let admin = false;
        try {
            // try to elevate to admin first to determine if we should search all assistants
            email = await validateUser(req, res, AuthType.Admin, true);
            admin = true;
        } catch (error) {
            email = await validateUser(req, res);
        }

        if (!email) {
            return;
        } else if (admin) {
            // if running as admin, then reset email to undefined so we can search all assistants
            email = undefined;
        }

        const org = admin?undefined:req.params.org;
        if (!org && !admin) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const project = typeof req.query.project === 'string' ? req.query.project : undefined;

        const aiAssistants : OpenAIAssistant[] = await searchOpenAIAssistants({ email, org, project });

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(aiAssistants);
            
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_org_connectors_openai_assistant = `user/:org/connectors/openai/assistants/:assistantId`;
app.get(`${api_root_endpoint}/${user_org_connectors_openai_assistant}`, async (req: Request, res: Response, next) => {

    let email : string | undefined = undefined;
    try {
        // try to elevate to admin first to determine - since we don't know what org the assistant may be attached to
        email = await validateUser(req, res, AuthType.Admin, true);

        if (!email) {
            return;
        }

        const org = req.params.org;

        if (!org) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const assistantId = req.params.assistantId;
        if (!assistantId) {
            return handleErrorResponse(email, new Error('AssistantId is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const aiAssistant : OpenAIAssistant | undefined = await getOpenAIAssistant(assistantId);
        if (!aiAssistant) {
            console.error(`${email} ${req.method} ${req.originalUrl} Assistant not found: ${assistantId}`);
            return res
                .status(HTTP_FAILURE_NOT_FOUND)
                .contentType('plain/text')
                .send('Assistant not found');
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(aiAssistant);
            
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_org_connectors_openai_assistants}`, async (req: Request, res: Response, next) => {

    let email : string | undefined = undefined;
    try {
        let admin = false;
        try {
            // try to elevate to admin first to determine if we should search all assistants
            email = await validateUser(req, res, AuthType.Admin, true);
            admin = true;
        } catch (error) {
            email = await validateUser(req, res);
        }
        if (!email) {
            return;
        } else if (admin) {
            // if running as admin, then reset email to undefined so we can search all assistants
            email = undefined;
        }

        const org = admin?undefined:req.params.org;
        if (!org && !admin) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const project = (typeof req.query.project === 'string') ? req.query.project : undefined;
        const startDate = (typeof req.query.startDate === 'string') ? req.query.startDate : undefined;
        const noFiles = req.query.noFiles != undefined;
        const confirm = req.query.confirm != undefined;

        const shouldDeleteAssistantHandler = async (assistant: OpenAIAssistant) : Promise<boolean> => {
            const createdDate = new Date(assistant.created_at * 1000);

            if (startDate) {
                if (assistant.created_at > parseInt(startDate)) {
                    const startingDate = new Date(parseInt(startDate) * 1000);
                    console.warn(`${email} ${req.method} ${req.originalUrl} Identified assistant ${assistant.name}:${assistant.id} for deletion - created at ${createdDate.toLocaleDateString()} after ${startingDate.toLocaleDateString()}`);
                    return true;
                }
            }
            if (noFiles) {
                if (!assistant.file_ids || assistant.file_ids.length === 0) {
                    console.warn(`${email} ${req.method} ${req.originalUrl} Identified assistant ${assistant.name}:${assistant.id} for deletion (created: ${createdDate.toLocaleDateString()}) - no files`);
                    return true;
                }
                // verify each openai file exists
                for (const fileId of assistant.file_ids) {
                    const file : OpenAIFile | undefined = await getOpenAIFile(fileId);
                    if (!file) {
                        console.warn(`${email} ${req.method} ${req.originalUrl} Identified assistant ${assistant.name}:${assistant.id} for deletion (created: ${createdDate.toLocaleDateString()}) - missing file ${fileId}`);
                        return true;
                    }
                }
            }
            console.log(`${email} ${req.method} ${req.originalUrl} Keeping assistant ${assistant.name}:${assistant.id} (created: ${createdDate.toLocaleDateString()})`);
            return false;
        }

        const aiAssistants : OpenAIAssistant[] = await searchOpenAIAssistants({ email, org, project },
            shouldDeleteAssistantHandler);
        
        if (confirm) {
            const deletedAssistants : OpenAIAssistant[] = [];
            for (const assistant of aiAssistants) {
                const beforeDeleteTimeInMs = Date.now();
                try {
                    await deleteOpenAIAssistant(assistant.id);
                    deletedAssistants.push(assistant);
                    console.info(`${email} ${req.method} ${req.originalUrl} Deleted assistant ${assistant.name}:${assistant.id} created at ${new Date(assistant.created_at * 1000).toLocaleDateString()}`);
                    const remainingTimeOutOfOneSecond = 1000 - (Date.now() - beforeDeleteTimeInMs);
                    if (remainingTimeOutOfOneSecond > 0) {
                        await delay(remainingTimeOutOfOneSecond);
                    }
                } catch (error) {
                    console.error(`${email} ${req.method} ${req.originalUrl} Error deleting assistant ${assistant.name}:${assistant.id} created at ${new Date(assistant.created_at * 1000).toLocaleDateString()}:`, error);
                }
            }
            return res
                .status(HTTP_SUCCESS)
                .contentType('application/json')
                .send(deletedAssistants);
        }

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(aiAssistants);
            
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

const user_org_connectors_openai_files_id = `user/:org/connectors/openai/files/:id`;
app.delete(`${api_root_endpoint}/${user_org_connectors_openai_files_id}`, async (req: Request, res: Response, next) => {

    let email : string | undefined = undefined;
    try {
        email = await validateUser(req, res);
        if (!email) {
            return;
        }

        const org = req.params.org;
        if (!org) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const fileId = req.params.id;
        if (!fileId) {
            return handleErrorResponse(email, new Error('FileId is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }
        
        await deleteAssistantFile(fileId);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(fileId);
            
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.delete(`${api_root_endpoint}/${user_org_connectors_openai_files}`, async (req: Request, res: Response, next) => {

    let email : string | undefined = undefined;
    try {
        let admin = false;

        try {
            // try to elevate to admin first to determine if we should search all files
            email = await validateUser(req, res, AuthType.Admin, true);
            admin = true;
        } catch (error) {
            email = await validateUser(req, res);
        }

        if (!email) {
            return;
        } else if (admin) {
            // if running as admin, then reset email to undefined so we can search all files
            email = undefined;
        }

        const org = admin?undefined:req.params.org;
        if (!org && !admin) {
            return handleErrorResponse(email, new Error('Org is required'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
        }

        const project : string | undefined = typeof req.query.project === 'string' ? req.query.project : undefined;
        const dataType : string | undefined = typeof req.query.dataType === 'string' ? req.query.dataType : undefined;
        let repoUri = undefined;
        if (project) {
            if (!email) {
                return handleErrorResponse(email, new Error('Email is required when deleting files in a project'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
            } else if (!org) {
                return handleErrorResponse(email, new Error('Org is required when deleting files in a project'), req, res, undefined, HTTP_FAILURE_BAD_REQUEST_INPUT);
            }
            const projectData = await loadProjectData(email, org, project);
            if (!projectData) {
                console.warn(`${email} ${req.method} ${req.originalUrl}  Project not found: ${org}/${project} - cannot filter on repos`);
            } else if (projectData.resources &&
                projectData.resources.length > 0) {
                repoUri = new URL(projectData.resources[0].uri);
            }
        }

        const shouldGroomInactiveFiles : boolean = req.query.groom != undefined;
        const userDeletionTime : string | undefined = req.query.afterDate as string | undefined;
        const deletionStartingDate : number = (userDeletionTime != undefined)?new Date(userDeletionTime).getTime() / 1000:0;

        const startAtFileId : string | undefined = req.query.startAtFile as string | undefined;

        const liveReferencedDataFiles : Map<string, OpenAIFile> = new Map();

        const activeFileIdsInAssistants : string[] = [];
        const assistantSearchHandler = async (assistant: OpenAIAssistant) : Promise<boolean> => {
            if (!assistant.file_ids?.length) {
                return false;
            }
            for (const fileId of assistant.file_ids) {
                activeFileIdsInAssistants.push(fileId);
            }
            return true;
        }

        // create a synchronous handler that will receive an OpenAIFile and check if it exists in liveReferenceDataFiles
        const shouldDeleteHandler = async (file: OpenAIFile) : Promise<boolean> => {
            if (!liveReferencedDataFiles.has(file.id)) {

                if (activeFileIdsInAssistants.includes(file.id)) {
                    console.warn(`${email} ${req.method} ${req.originalUrl} Identified file ${file.filename}:${file.id} for grooming, but it is still in use`);
                    return false;
                }

                if (process.env.TRACE_LEVEL) {
                    console.warn(`${email} ${req.method} ${req.originalUrl} Identified file ${file.filename}:${file.id} for grooming`);
                }
                return true;
            }

            if (!activeFileIdsInAssistants.includes(file.id)) {
                console.warn(`${email} ${req.method} ${req.originalUrl} File ${file.filename}:${file.id} is reported to to be active, but not linked to any assistant`);
            }

            console.debug(`${email} ${req.method} ${req.originalUrl} File ${file.filename}:${file.id} is still in use`);
            return false;
        }
        if (shouldGroomInactiveFiles) {

            const assistants = await searchOpenAIAssistants({email, org, project}, assistantSearchHandler);

            console.log(`${email} ${req.method} ${req.originalUrl} Found ${activeFileIdsInAssistants.length} active files in ${assistants.length} assistants`);

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

        const aiFiles : OpenAIFile[] = await deleteOpenAIFiles(
            {email, org, project, repoUri, dataType, creationStart: deletionStartingDate, startAtFileId: startAtFileId},
            shouldGroomInactiveFiles?shouldDeleteHandler:undefined);

        return res
            .status(HTTP_SUCCESS)
            .contentType('application/json')
            .send(aiFiles);
            
    } catch (error) {
        return handleErrorResponse(email, error, req, res);
    }
});

app.get("/test", (req: Request, res: Response, next) => {

    try {
        logRequest(req, "");

        return res
            .status(HTTP_SUCCESS)
            .contentType("text/plain")
            .send("Test HTTP GET Ack");
    } catch (error) {
        return handleErrorResponse(undefined, error, req, res);
    }
});

app.post("/test", (req: Request, res: Response, next) => {

    try {
        logRequest(req, "");

        const data = req.body;

        return res
            .status(HTTP_SUCCESS)
            .contentType("text/plain")
            .send(`Test HTTP POST Ack: ${data}`);
    } catch (error) {
        return handleErrorResponse(undefined, error, req, res);
    }
});

app.patch("/test", (req: Request, res: Response, next) => {

    try {
        logRequest(req, "");

        const data = req.body;

        return res
            .status(HTTP_SUCCESS)
            .contentType("text/plain")
            .send(`Test HTTP PATCH Ack: ${data}`);
    } catch (error) {
        return handleErrorResponse(undefined, error, req, res);
    }
});

module.exports.handler = serverless(app);