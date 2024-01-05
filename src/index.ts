import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import {
    getProjectData,
    storeProjectData,
    SourceType,
    convertToSourceType,
    deleteProjectData
} from './storage';
import { validateUser } from './auth';
import { getFolderPathsFromRepo, getFileFromRepo, getFilePathsFromRepo } from './github';
import { uploadProjectDataForAIAssistant } from './openai';
import { UserProjectData } from './types/UserProjectData';

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

const user_resource_file = `/user_resource_file`;
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

    getFileFromRepo(email, uri, req, res);
});

const user_resource_folders = `/user_resource_folders`;
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

    getFolderPathsFromRepo(email, uri, req, res);
});

const user_resource_files = `/user_resource_files`;
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

    getFilePathsFromRepo(email, uri, req, res);
});

async function getCachedProjectData(ownerName: string, sourceType: SourceType, repoName: string, resourcePath: string, projectDataType: string): Promise<string | undefined> {
    let partNumber = 1;
    let projectData = await getProjectData(ownerName, sourceType, ownerName, repoName, resourcePath, projectDataType);
    
    if (projectData) {
        return projectData;
    }

    if (await doesPartExist(ownerName, repoName, resourcePath, projectDataType, 1)) {
        let allData = '';
        while (true) {
            const partData = await getProjectData(ownerName, sourceType, ownerName, repoName, resourcePath, `${projectDataType}:part-${partNumber}`);
            if (!partData) break;
            allData += partData;
            partNumber++;
        }
        projectData = allData;
    }

    return projectData;
}

// Helper function to check if a specific part exists
async function doesPartExist(ownerName: string, repoName: string, resourcePath: string, projectDataType: string, partNumber: number): Promise<boolean> {
    const partData = await getProjectData(ownerName, SourceType.GitHub, ownerName, repoName, resourcePath, `${projectDataType}:part-${partNumber}`);
    return partData !== undefined;
}

const user_project_org_project = `/user_project/:org/:project`;
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
    if (typeof body !== 'string') {
        if (Array.isArray(body)) {
            body = Buffer.from(body).toString('utf8');
        } else {
            body = JSON.stringify(body);
        }
    }
    const updatedProject = JSON.parse(body);

    // if there are resources passed into the project, and the resources are an array of strings
    //      the we need to convert the array of strings into an array of ProjectResource objects
    if (updatedProject.resources && Array.isArray(updatedProject.resources)) {
        const resources : any[] = [];
        for (const resource of updatedProject.resources) {
            resources.push({
                uri: resource,
                type: ResourceType.PrimaryReadWrite,
                access: ResourceStatus.Unknown,
            } as ProjectResource);
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
    console.log(`user_project_goals: deleted data`);

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
        if (Array.isArray(body)) {
            body = Buffer.from(body).toString('utf8');
        } else {
            body = JSON.stringify(body);
        }
    }
    await storeProjectData(email, SourceType.General, org, project, '', 'goals', body);

    console.log(`${user_project_org_project_goals}: stored data`);

    return res
        .status(200)
        .send();
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

    console.log(`${user_project_org_project_goals}: retrieved data`);

    // create an object with the project goals
    const projectGoals = {
        org : org,
        name : project,
        goals : projectGoalsRaw,
    };

    return res
        .status(200)
        .contentType('application/json')
        .send(JSON.stringify(projectGoals));
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

    // we store the project data under the owner (instead of email) so all users in the org can see the data
    // NOTE - we are storing the data for ONLY the first resource in the project (references are not included yet)

    const { _, __, resource } = req.params;
    const resourceData = await getCachedProjectData(ownerName, SourceType.GitHub, repoName, '', resource);

    console.log(`${user_project_org_project_data_resource}: retrieved data`);
    return res.status(200).send(resourceData);
});

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

app.post(`${api_root_endpoint}${user_project_org_project_data_resource}`, async (req: Request, res: Response) => {
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
    await splitAndStoreData(ownerName, SourceType.GitHub, ownerName, repoName, '', resource, body);

    console.log(`${user_project_org_project_data_resource}: stored data`);
    return res.status(200).send();
});

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

const user_project_org_project_data_resource_generator = `/user_project/:org/:project/data/:resource/generator`;
app.post(`${api_root_endpoint}${user_project_org_project_data_resource_generator}`, async (req: Request, res: Response) => {
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
    await splitAndStoreData(ownerName, SourceType.GitHub, ownerName, repoName, '', resource, body);

    console.log(`${user_project_org_project_data_resource_generator}: stored data`);
    return res.status(200).send();
});

const user_project_org_project_data_references = `/user_project/:org/:project/data_references`;
app.post(`${api_root_endpoint}${user_project_org_project_data_references}`, async (req: Request, res: Response) => {
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

    const projectDataTypes = [];
    projectDataTypes.push('projectsource');
    projectDataTypes.push('aispec');
    projectDataTypes.push('blueprint');

    const projectDataNames = [];
    projectDataNames.push(`allfiles_combined.md`);
    projectDataNames.push(`aispec.md`);
    projectDataNames.push('blueprint.md');

    try {
        for (let i = 0; i < projectDataTypes.length; i++) {
            let projectData = await getCachedProjectData(ownerName, SourceType.GitHub, repoName, "", projectDataTypes[i]);
            if (!projectData) {
                // data not found in KV cache - must be manually uploaded for now per project
                console.log(`${user_project_org_project_data_references}: no data found for ${projectDataTypes[i]}`);
                return res.status(400).send(`No data found for ${projectDataTypes[i]}`);
            }

            console.log(`${user_project_org_project_data_references}: retrieved project data for ${projectDataTypes[i]}`);

            try {
                const storedProjectDataId : any[] = await uploadProjectDataForAIAssistant(`${userProjectData.org}_${userProjectData.name}`, uri, projectDataTypes[i], projectDataNames[i], projectData, req, res);
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

    await storeProjectData(email, SourceType.General, userProjectData.org, userProjectData.name, '', 'data_references', projectDataFileIds);

    console.log(`${user_project_org_project_data_references}: stored data`);

    return res.status(200).send();
});

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

    const dataReferences : any[] = await getProjectData(email, SourceType.General, projectData.org, projectData.name, '', 'data_references');
    if (!dataReferences) {
        console.error(`No resources found in project: ${projectData.org}/${projectData.name}`);
        return res.status(400).send('No data references found for project');
    }

    console.log(`${user_project_org_project_data_references}: retrieved ids`);

    return res
        .status(200)
        .contentType('application/json')
        .send(JSON.stringify(dataReferences));

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

app.get("/test", (req, res, next) => {
    return res
        .status(200)
        .contentType("text/plain")
        .send("Test Ack");
});

module.exports.handler = serverless(app);