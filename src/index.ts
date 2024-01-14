import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import {
    getProjectData,
    storeProjectData,
    SourceType,
    convertToSourceType,
    deleteProjectData
} from './storage';
import { validateUser, signedAuthHeader } from './auth';
import { getFolderPathsFromRepo, getFileFromRepo, getFilePathsFromRepo } from './github';
import { uploadProjectDataForAIAssistant } from './openai';
import { UserProjectData } from './types/UserProjectData';
import { GeneratorState, TaskStatus, Stages } from './types/GeneratorState';
import { ProjectResource, ResourceType, ResourceStatus } from './types/ProjectResource';
import axios from 'axios';
import { ProjectDataReference } from './types/ProjectDataReference';

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

export const app = express();

app.use(express.json()); // Make sure to use express.json middleware to parse JSON request body

const api_root_endpoint : string = '/api';

/*
// Error handling middleware
app.use((err : any, req : Request, res : Response) => {
    console.error(`Request ${req} failed with error ${err}`);
    res.status(500).send('Internal Server Error');
});
*/

export async function localSelfDispatch(email: string, originalIdentityHeader: string, initialRequest: Request, path: string, httpVerb: string, body?: any): Promise<any> {

    let selfEndpoint = `${initialRequest.protocol}://${initialRequest.get('host')}/${api_root_endpoint}/${path}`;
    // if we're running locally, then we'll use http:// no matter what
    if (initialRequest.get('host')!.includes('localhost')) {
        selfEndpoint = `http://${initialRequest.get('host')}${api_root_endpoint}/${path}`;
    }

    // convert above to fetch
    const response = await fetch(selfEndpoint, {
        method: httpVerb,
        headers: {
            'Content-Type': 'application/json',
            'X-Signed-Identity': originalIdentityHeader,
        },
        body: JSON.stringify(body)?body:undefined,
    });
    if (response.ok) {
        return await response.json();
    }

    throw new Error(`Request ${selfEndpoint} failed with status ${response.status}`);
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
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const projectData = await loadProjectData(email, req, res) as UserProjectData;
    if (projectData instanceof Response) {
        return projectData;
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

    // we store the project data under the owner (instead of email) so all users in the org can see the data
    // NOTE - we are storing the data for ONLY the first resource in the project (references are not included yet)
    // if req body is not a string, then we need to convert back into a normal string
    let body = req.body;
    if (typeof body !== 'string') {
        body = Buffer.from(body).toString('utf8');
    }

    const { _, __, resource } = req.params;

    await saveProjectDataResource(email, ownerName, repoName, resource, '', body);

    console.log(`${user_project_org_project_data_resource}: stored data`);
    return res.status(200).send();
};

async function loadProjectData(email: string, req: Request, res: Response): Promise<UserProjectData | Response> {
    const { org, project } = req.params;

    if (!org || !project) {
        if (!org) {
            console.error(`Org is required`);
        } else if (!project) {
            console.error(`Project is required`);
        }

        return res.status(400).send('Invalid resource path');
    }

    let projectData = await getProjectData(email, SourceType.General, org, project, '', 'project');
    if (!projectData) {
        console.error(`loadProjectData: not found: ${org}/${project}`);
        return res.status(404).send('Project not found');
    }
    projectData = JSON.parse(projectData) as UserProjectData;
    console.log(`loadProjectData: retrieved data`);

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

const user_resource_file = `/user/:org/connectors/github/file`;
app.get(`${api_root_endpoint}${user_resource_file}`, async (req: Request, res: Response) => {
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

    if (!req.get('X-Signed-Identity')) {
        console.error(`Unauthorized: Signed Header missing`);
        return res.status(401).send('Unauthorized');
    }
    const accountStatus : UserAccountState = await localSelfDispatch(email, req.get('X-Signed-Identity')!, req, `user/${org}/account`, 'GET');
    const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

    getFileFromRepo(email, uri, req, res, privateAccessAllowed);
});

const user_resource_folders = `/user/:org/connectors/github/folders`;
app.get(`${api_root_endpoint}${user_resource_folders}`, async (req: Request, res: Response) => {
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

    const accountStatus : UserAccountState = await localSelfDispatch(email, req.get('X-Signed-Identity')!, req, `user/${org}/account`, 'GET');
    const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

    getFolderPathsFromRepo(email, uri, req, res, privateAccessAllowed);
});

const user_resource_files = `/user/:org/connectors/github/files`;
app.get(`${api_root_endpoint}${user_resource_files}`, async (req: Request, res: Response) => {
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

    const accountStatus : UserAccountState = await localSelfDispatch(email, req.get('X-Signed-Identity')!, req, `user/${org}/account`, 'GET');
    const privateAccessAllowed = checkPrivateAccessAllowed(accountStatus);

    getFilePathsFromRepo(email, uri, req, res, privateAccessAllowed);
});

const user_project_org_project = `/user_project/:org/:project`;
app.patch(`${api_root_endpoint}${user_project_org_project}`, async (req: Request, res: Response) => {

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
    }
    if (body.guidelines !== undefined) {
        updates.guidelines = body.guidelines;
    }
  
    const projectData = await loadProjectData(email, req, res) as UserProjectData; 
    Object.assign(projectData, updates);
    const storedProjectString = JSON.stringify(projectData);

    await storeProjectData(email, SourceType.General, org, project, '', 'project', storedProjectString);
    console.log(`${user_project_org_project}: updated data`);

    return res
        .status(200)
        .send();
});

app.post(`${api_root_endpoint}${user_project_org_project}`, async (req: Request, res: Response) => {
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

    // if there are resources passed into the project, and the resources are an array of strings
    //      the we need to convert the array of strings into an array of ProjectResource objects
    if (updatedProject.resources && Array.isArray(updatedProject.resources)) {
        const resources : any[] = [];
        for (const resource of updatedProject.resources) {
            if (typeof resource !== 'string') {
                resources.push(resource);
            } else {
                resources.push({
                    uri: resource,
                    type: ResourceType.PrimaryReadWrite,
                    access: ResourceStatus.Unknown,
                } as ProjectResource);
            }
        }
        updatedProject.resources = resources;
    }
    const storedProject : UserProjectData = {
        org : org,
        name : project,
        guidelines : updatedProject.guidelines? updatedProject.guidelines : '',
        resources : updatedProject.resources? updatedProject.resources : [],
    };

    const storedProjectString = JSON.stringify(storedProject);

    await storeProjectData(email, SourceType.General, org, project, '', 'project', storedProjectString);

    console.log(`${user_project_org_project}: stored data`);

    return res
        .status(200)
        .send();
});

app.get(`${api_root_endpoint}${user_project_org_project}`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const projectData = await loadProjectData(email, req, res) as UserProjectData;
    if (projectData instanceof Response) {
        return projectData;
    }

    return res
        .status(200)
        .contentType('application/json')
        .send(JSON.stringify(projectData));
});

app.delete(`${api_root_endpoint}${user_project_org_project}`, async (req: Request, res: Response) => {
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
});

// create an object with the project goals
interface ProjectGoals {
    goals?: string;
}

const user_project_org_project_goals = `/user_project/:org/:project/goals`;
app.delete(`${api_root_endpoint}${user_project_org_project_goals}`, async (req: Request, res: Response) => {
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
});

app.post(`${api_root_endpoint}${user_project_org_project_goals}`, async (req: Request, res: Response) => {
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
        .send(JSON.parse(body));
});

app.get(`${api_root_endpoint}${user_project_org_project_goals}`, async (req: Request, res: Response) => {
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

    console.log(`${user_project_org_project_goals}: retrieved data`);

    return res
        .status(200)
        .contentType('application/json')
        .send(projectGoals);
});

const user_project_org_project_config_boostignore = `/user_project/:org/:project/config/.boostignore`;
app.get(`${api_root_endpoint}${user_project_org_project_config_boostignore}`, async (req: Request, res: Response) => {
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
});

const user_project_org_project_data_resource = `/user_project/:org/:project/data/:resource`;
app.get(`${api_root_endpoint}${user_project_org_project_data_resource}`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const projectData = await loadProjectData(email, req, res) as UserProjectData;
    if (projectData instanceof Response) {
        return projectData;
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

    console.log(`${user_project_org_project_data_resource}: retrieved data`);
    return res
        .status(200)
        .contentType('application/json')
        .send(resourceData);
});

app.delete(`${api_root_endpoint}${user_project_org_project_data_resource}`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const projectData = await loadProjectData(email, req, res) as UserProjectData;
    if (projectData instanceof Response) {
        return projectData;
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
        .contentType('application/json')
        .send();
});

app.route(`${api_root_endpoint}${user_project_org_project_data_resource}`)
   .post(postOrPutUserProjectDataResource)
   .put(postOrPutUserProjectDataResource);

const user_project_org_project_data_resource_generator = `/user_project/:org/:project/data/:resource/generator`;
app.get(`${api_root_endpoint}${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const projectData = await loadProjectData(email, req, res) as UserProjectData;
    if (projectData instanceof Response) {
        return projectData;
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
        console.log(`${user_project_org_project_data_resource_generator}: retrieved data`);

        return res
            .status(200)
            .contentType('application/json')
            .send(currentInput);
    }
});

// for updating the generator task status
app.patch(`${api_root_endpoint}${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return res;
    }

    const loadedProjectData = await loadProjectData(email, req, res) as UserProjectData | Response;
    if (loadedProjectData instanceof Response) {
        return loadedProjectData as Response;
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
        body = JSON.stringify(body);
    }

    const input : GeneratorState = JSON.parse(body);
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
    };

    // if we're only updating the timestamp on the processing, then don't kick off any new work
    if (currentGeneratorState.status === TaskStatus.Processing) {
        if (userGeneratorRequest.last_updated && currentGeneratorState.status_details) {
            currentGeneratorState.last_updated = userGeneratorRequest.last_updated;
            currentGeneratorState.status_details = userGeneratorRequest.status_details;

            console.log(`${user_project_org_project_data_resource_generator}: updated processing task: ${JSON.stringify(currentGeneratorState)}`);
            await updateGeneratorState(currentGeneratorState);

            return res
                .status(200)
                .contentType('application/json')
                .send(currentGeneratorState);
        }
    } else {
        // patch is only supported for processing tasks
        console.error(`Invalid PATCH status: ${currentGeneratorState.status}`);
        return res.status(400).send(`Invalid PATCH status: ${currentGeneratorState.status}`)
    }
});

const putOrPostuserProjectDataResourceGenerator = async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return res;
    }

    const loadedProjectData = await loadProjectData(email, req, res) as UserProjectData | Response;
    if (loadedProjectData instanceof Response) {
        return loadedProjectData as Response;
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
        body = JSON.stringify(body);
    }

    const input : GeneratorState = JSON.parse(body);
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
    };

    try {
        if (userGeneratorRequest.status === TaskStatus.Processing) {

            console.log(`${user_project_org_project_data_resource_generator}: processing task: ${JSON.stringify(userGeneratorRequest)}`);

            try {
                currentGeneratorState.status = TaskStatus.Processing;
                await updateGeneratorState(currentGeneratorState);

                // Launch the processing task
                let selfEndpoint = `${req.protocol}://${req.get('host')}`;
                // if we're running locally, then we'll use http:// no matter what
                if (req.get('host')!.includes('localhost')) {
                    selfEndpoint = `http://${req.get('host')}`;
                }

                currentGeneratorState.stage = await processStage(selfEndpoint, email, projectData, resource, currentGeneratorState.stage);

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
                        console.error(`Resetting to ${processingError.stage} due to error in ${resource} stage ${currentGeneratorState.stage}:`, processingError);
                    }
                }

                // In case of error, set status to error
                currentGeneratorState.status = TaskStatus.Error;

                await updateGeneratorState(currentGeneratorState);

                // we errored out, so we'll return an error HTTP status code for operation failed, may need to retry
                return res.status(500).send();
            }

            // if we're processing and not yet completed the full stages, then we need to process the next stage
            if (currentGeneratorState.status === TaskStatus.Processing && currentGeneratorState.stage !== Stages.Complete) {
                // we need to terminate the current call so we don't create a long blocking HTTP call
                //      so we'll start a new async HTTP request - detached from the caller to continue processing
                //      the next stage
                console.log(`${user_project_org_project_data_resource_generator}: starting async processing for ${currentGeneratorState}`);

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
                axios.put(selfEndpoint, newProcessingRequest, {
                        headers: {
                            'Content-Type': 'application/json',
                            ...authHeader,
                        },
                        timeout: 2000 })
                    .then(response => {
                        // if the new task stage completes in 2 seconds, we'll wait...
                        console.log(`${user_project_org_project_data_resource_generator}: Async Processing completed for ${newProcessingRequest}: `, response.status);
                    })
                        // otherwise, we'll move on
                    .catch(error => {
                        if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                            console.log(`${user_project_org_project_data_resource_generator}: Async Processing started for ${newProcessingRequest}`);
                        } else {
                            console.log(`${user_project_org_project_data_resource_generator}: Async Processing failed for ${newProcessingRequest}: `, error);
                        }
                    });
                                
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
                    currentGeneratorState.last_updated > (Math.floor(Date.now() / 1000) - 60 * 3)) {
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
};

app.route(`${api_root_endpoint}${user_project_org_project_data_resource_generator}`)
   .post(putOrPostuserProjectDataResourceGenerator)
   .put(putOrPostuserProjectDataResourceGenerator);

async function processStage(serviceEndpoint: string, email: string, project: UserProjectData, resource: string, stage?: string) {
    if (stage) {
        console.log(`Processing ${resource} stage ${stage}...`);
    }
    switch (resource) {
        case ProjectDataType.ProjectSource:
            throw new Error(`Not implemented: ${resource}`);
        case ProjectDataType.ProjectSpecification:
            throw new Error(`Not implemented: ${resource}`);
        case ProjectDataType.ArchitecturalBlueprint:
            return new BlueprintGenerator(serviceEndpoint, email, project).generate(stage);
        default:
            throw new Error(`Invalid resource: ${resource}`);
    }
}

const user_project_org_project_data_references = `/user_project/:org/:project/data_references`;

const userProjectDataReferences = async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const userProjectData = await loadProjectData(email, req, res) as UserProjectData;
    if (userProjectData instanceof Response) {
        return userProjectData;
    }

    if (!userProjectData.resources || userProjectData.resources.length === 0) {
        console.error(`No resources found in project: ${userProjectData.org}/${userProjectData.name}`);
        return res.status(400).send('No resources found in project');
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
                return res.status(400).send(`No data found for ${projectDataTypes[i]}`);
            }

            console.log(`${user_project_org_project_data_references}: retrieved project data for ${projectDataTypes[i]}`);

            try {
                const storedProjectDataId = await uploadProjectDataForAIAssistant(`${userProjectData.org}_${userProjectData.name}`, uri, projectDataTypes[i], projectDataNames[i], projectData, req, res);
                console.log(`${user_project_org_project_data_references}: found File Id for ${projectDataTypes[i]} under ${projectDataNames[i]}: ${storedProjectDataId}`);

                projectDataFileIds.push(storedProjectDataId);
            } catch (error) {
                console.error(`Handler Error: ${user_project_org_project_data_references}: Unable to store project data:`, error);
                console.error(`Error storing project data:`, error);
                return res.status(500).send('Internal Server Error');
            }
        }
    } catch (error) {
        console.error(`Handler Error: ${user_project_org_project_data_references}: Unable to retrieve project data:`, error);
        return res.status(500).send('Internal Server Error');
    }

    await storeProjectData(email, SourceType.General, userProjectData.org, userProjectData.name, '', 'data_references', JSON.stringify(projectDataFileIds));

    console.log(`${user_project_org_project_data_references}: stored data`);

    return res
        .status(200)
        .contentType('application/json')
        .send(projectDataFileIds);
};

app.route(`${api_root_endpoint}${user_project_org_project_data_references}`)
   .post(userProjectDataReferences)
   .put(userProjectDataReferences);

app.get(`${api_root_endpoint}${user_project_org_project_data_references}`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const projectData = await loadProjectData(email, req, res) as UserProjectData;
    if (projectData instanceof Response) {
        return projectData;
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

    console.log(`${user_project_org_project_data_references}: retrieved ids`);

    return res
        .status(200)
        .contentType('application/json')
        .send(dataReferences);

});

app.delete(`${api_root_endpoint}${user_project_org_project_data_references}`, async (req: Request, res: Response) => {
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
});

const files_source_owner_project_path_analysisType = `/files/:source/:owner/:project/:pathBase64/:analysisType`;
app.delete(`${api_root_endpoint}${files_source_owner_project_path_analysisType}`, async (req, res) => {
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
            .contentType('application/json')
            .send();

    } catch (error) {
        console.error(`Handler Error: ${files_source_owner_project_path_analysisType}`, error);
        return res.status(500).send('Internal Server Error');
    }
});

app.get(`${api_root_endpoint}${files_source_owner_project_path_analysisType}`, async (req, res) => {
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
        console.error(`Handler Error: ${files_source_owner_project_path_analysisType}`, error);
        return res.status(500).send('Internal Server Error');
    }
});

app.post(`${api_root_endpoint}${files_source_owner_project_path_analysisType}`, async (req, res) => {
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
        console.error(`Handler Error: ${files_source_owner_project_path_analysisType}`, error);
        return res.status(500).send('Internal Server Error');
    }
});

const proxy_ai_endpoint = "/proxy/ai/:org/:endpoint";
const handleProxyRequest = async (req: Request, res: Response) => {
    const org = req.params.org;
    const endpoint = req.params.endpoint;

    const email = await validateUser(req, res);
    if (!email) {
        return res.status(401).send('Unauthorized');
    }

    const signedIdentity = await signedAuthHeader(email, org);

    let externalEndpoint;
    if (req.get('host')!.includes('localhost')) {
        // this is the default local endpoint of the boost AI lambda python (chalice) server
        externalEndpoint = `http://localhost:8000/${endpoint}`;
    } else {
        externalEndpoint = Endpoints.get(endpoint as Services);
    }

    const fetchOptions : any = {
        method: req.method,
        headers: {
            'Accept': 'application/json',
            ...signedIdentity
        }
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        fetchOptions.body = req.body;
    }

    try {
        const response = await fetch(externalEndpoint, fetchOptions);

        if (response.ok) {
            const responseObject = await response.json();
            return res.
                status(200).
                contentType('application/json').
                send(responseObject);
        } else {
            return res.status(response.status).send(response.statusText);
        }
    } catch (error : any) {
        // check for ECONNREFUSED error from fetch
        if (error.errno === 'ECONNREFUSED') {
            console.error(`Error making proxy request - endpoint refused request: ${externalEndpoint}`, error);
            return res.status(500).send('Internal Server Error');
        }

        console.error('Error making proxy request:', error);
        return res.status(500).send('Internal Server Error');
    }
};

app.route(`${api_root_endpoint}${proxy_ai_endpoint}`)
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

const user_org_account = `/user/:org/account`;
app.get(`${api_root_endpoint}${user_org_account}`, async (req, res) => {
    const org = req.params.org;

    const email = await validateUser(req, res);
    if (!email) {
        return res.status(401).send('Unauthorized');
    }

    const identityHeader = req.headers['x-signed-identity'] as string;
    const result = await localSelfDispatch(email, identityHeader, req, `proxy/ai/${org}/${Services.CustomerPortal}`, "GET");

    return res
        .status(200)
        .contentType('application/json')
        .send(result);
});

const user_profile = `/user/profile`;
app.delete(`${api_root_endpoint}${user_profile}`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    await deleteProjectData(email, SourceType.General, 'user', '', '', 'profile');
    console.log(`${user_profile}: deleted data`);

    return res
        .status(200)
        .send();
});

interface UserProfile {
    name?: string,
    title?: string,
    details?: string,
};

app.put(`${api_root_endpoint}${user_profile}`, async (req: Request, res: Response) => {
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

    const newProfileData = JSON.parse(body) as UserProfile;
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
});

app.get(`${api_root_endpoint}${user_profile}`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const profileRaw = await getProjectData(email, SourceType.General, 'user', '', '', 'profile');
    let profileData: UserProfile = {};
    if (profileRaw) {
        profileData = JSON.parse(profileRaw) as UserProfile;
    }

    console.log(`${user_profile}: retrieved data`);

    return res
        .status(200)
        .contentType('application/json')
        .send(profileData);
});

app.get("/test", (req: Request, res: Response, next) => {
    console.log("Test Console Ack");
    return res
        .status(200)
        .contentType("text/plain")
        .send("Test HTTP Ack");
});

module.exports.handler = serverless(app);