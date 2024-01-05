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
import { getFolderPathsFromRepo, get_file_from_uri as getFileFromRepo } from './github';
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

app.get(`${api_root_endpoint}/user_resource_file`, async (req: Request, res: Response) => {
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

app.get(`${api_root_endpoint}/user_resource_folders`, async (req: Request, res: Response) => {
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

app.post(`${api_root_endpoint}/user_project/:org/:project`, async (req: Request, res: Response) => {
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
        project_name : project,
        guidelines : updatedProject.guidelines? updatedProject.guidelines : '',
        resources : updatedProject.resources? updatedProject.resources : [],
    };

    const storedProjectString = JSON.stringify(storedProject);

    await storeProjectData(email, SourceType.General, org, project, '', 'project', storedProjectString);

    console.log(`user_project: stored data`);

    return res
        .status(200)
        .send();
});

app.get(`${api_root_endpoint}/user_project/:org/:project`, async (req: Request, res: Response) => {
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

    let projectData = await getProjectData(email, SourceType.General, org, project, '', 'project');

    if (!projectData) {
        console.error(`Project not found: ${org}/${project}`);
        return res.status(404).send('Project not found');
    }
    projectData = JSON.parse(projectData);
    if (projectData.resources && projectData.resources.length > 0) {
        // we need to convert the resources string array into an array of ProjectResource objects
        const resources : any[] = [];
        for (const resource of projectData.resources) {
            resources.push({
                uri: resource,
                type: ResourceType.PrimaryReadWrite,
                public: false,
            });
        }
    }

    console.log(`user_project: retrieved data`);

    // create an object with the string fields, org, project_name, guidelines, array of string resources
    const userProjectData : UserProjectData = {
        org : org,
        project_name : project,
        guidelines : projectData.guidelines? projectData.guidelines : '',
        resources : projectData.resources? projectData.resources : [],
    };

    return res
        .status(200)
        .header('Content-Type', 'application/json')
        .send(JSON.stringify(userProjectData));
});

app.delete(`${api_root_endpoint}/user_project/:org/:project`, async (req: Request, res: Response) => {
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
    console.log(`user_project: deleted data`);

    return res
        .status(200)
        .send();
});

app.delete(`${api_root_endpoint}/user_project/:org/:project/goals`, async (req: Request, res: Response) => {
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

app.post(`${api_root_endpoint}/user_project/:org/:project/goals`, async (req: Request, res: Response) => {
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

    console.log(`user_project_goals: stored data`);

    return res
        .status(200)
        .send();
});

app.get(`${api_root_endpoint}/user_project/:org/:project/goals`, async (req: Request, res: Response) => {
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

    console.log(`user_project_goals: retrieved data`);

    // create an object with the project goals
    const projectGoals = {
        org : org,
        user: email,
        project_name : project,
        goals : projectGoalsRaw,
    };

    return res
        .status(200)
        .header('Content-Type', 'application/json')
        .send(JSON.stringify(projectGoals));
});

app.get(`${api_root_endpoint}/user_project/:org/:project/data/:resource`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const { org, project, resource } = req.params;

    if (!org || !project || !resource) {
        if (!org) {
            console.error(`Org is required`);
        } else if (!project) {
            console.error(`Project is required`);
        } else if (!resource) {
            console.error(`Resource is required`);
        }

        return res.status(400).send('Invalid resource path');
    }

    let projectData = await getProjectData(email, SourceType.General, org, project, '', 'project');
    if (!projectData) {
        console.error(`Project not found: ${org}/${project}`);
        return res.status(404).send('Project not found');
    }
    projectData = JSON.parse(projectData) as UserProjectData;
    console.log(`user_project: retrieved data`);

    const uri = new URL(projectData.resources[0] as string);

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

    const resourceData = await getCachedProjectData(ownerName, SourceType.GitHub, repoName, '', resource);

    console.log(`user_project_data: retrieved data`);
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

app.post(`${api_root_endpoint}/user_project/:org/:project/data/:resource`, async (req: Request, res: Response) => {
    const email = await validateUser(req, res);
    if (!email) {
        return;
    }

    const { org, project, resource } = req.params;

    if (!org || !project || !resource) {
        if (!org) {
            console.error(`Org is required`);
        } else if (!project) {
            console.error(`Project is required`);
        } else if (!resource) {
            console.error(`Resource is required`);
        }

        return res.status(400).send('Invalid resource path');
    }

    let projectData = await getProjectData(email, SourceType.General, org, project, '', 'project');
    if (!projectData) {
        console.error(`Project not found: ${org}/${project}`);
        return res.status(404).send('Project not found');
    }
    projectData = JSON.parse(projectData) as UserProjectData;
    console.log(`user_project: retrieved data`);

    const uri = new URL(projectData.resources[0] as string);
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
    await splitAndStoreData(ownerName, SourceType.GitHub, ownerName, repoName, '', resource, body);

    console.log(`user_project_data: stored data`);
    return res.status(200).send();
});

app.post(`${api_root_endpoint}/user_project/:org/:project/data_references`, async (req: Request, res: Response) => {
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

    let projectData = await getProjectData(email, SourceType.General, org, project, '', 'project');
    if (projectData) {
        projectData = JSON.parse(projectData) as UserProjectData;
    }
    if (!projectData.resources || projectData.resources.length === 0) {
        console.error(`No resources found in project: ${org}/${project}`);
        return res.status(400).send('No resources found in project');
    }
    const uri = new URL(projectData.resources[0] as string);

    console.log(`user_project_data_references: Request validated uri: ${uri}`);

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
                console.log(`user_project_data_references: no data found for ${projectDataTypes[i]}`);
                return res.status(400).send(`No data found for ${projectDataTypes[i]}`);
            }

            console.log(`user_project_data_references: retrieved project data for ${projectDataTypes[i]}`);

            try {
                const storedProjectDataId : any[] = await uploadProjectDataForAIAssistant(`${org}_${project}`, uri, projectDataTypes[i], projectDataNames[i], projectData, req, res);
                console.log(`user_project_data_references: found File Id for ${projectDataTypes[i]} under ${projectDataNames[i]}: ${storedProjectDataId}`);
                projectDataFileIds.push(storedProjectDataId);
            } catch (error) {
                console.error(`Handler Error: user_project_data_references: Unable to store project data:`, error);
                console.error(`Error storing project data:`, error);
                return res.status(500).send('Internal Server Error');
            }
        }
    } catch (error) {
        console.error(`Handler Error: user_project_data_references: Unable to retrieve project data:`, error);
        return res.status(500).send('Internal Server Error');
    }

    await storeProjectData(email, SourceType.General, org, project, '', 'data_references', projectDataFileIds);

    console.log(`user_project_data_references: stored data`);

    return res.status(200).send();
});

app.get(`${api_root_endpoint}/user_project/:org/:project/data_references`, async (req: Request, res: Response) => {
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

    let projectData = await getProjectData(email, SourceType.General, org, project, '', 'project');
    if (projectData) {
        projectData = JSON.parse(projectData) as UserProjectData;
    }
    if (!projectData.resources || projectData.resources.length === 0) {
        console.error(`No resources found in project: ${org}/${project}`);
        return res.status(400).send('No resources found in project');
    }
    const uri = new URL(projectData.resources[0] as string);

    const dataReferences : any[] = await getProjectData(email, SourceType.General, org, project, '', 'data_references');
    if (!dataReferences) {
        console.error(`No resources found in project: ${org}/${project}`);
        return res.status(400).send('No data references found for project');
    }

    console.log(`user_project_data_references: retrieved ids`);

    return res
        .status(200)
        .header('Content-Type', 'application/json')
        .send(JSON.stringify(dataReferences));

});

app.delete(`${api_root_endpoint}/user_project/:org/:project/data_references`, async (req: Request, res: Response) => {
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
    console.log(`user_project_data_references: deleted data`);

    return res
        .status(200)
        .send();
});

app.delete(`${api_root_endpoint}/files/:source/:owner/:project/:pathBase64/:analysisType`, async (req, res) => {
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
            .header('Content-Type', 'application/json')
            .send();

    } catch (error) {
        console.error(`Handler Error: /api/files/:source/:owner/:project/:pathBase64/:analysisType`, error);
        return res.status(500).send('Internal Server Error');
    }
});

app.get(`${api_root_endpoint}/files/:source/:owner/:project/:pathBase64/:analysisType`, async (req, res) => {
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

        return res.status(200).header('Content-Type', 'text/plain').send(data);
    } catch (error) {
        console.error(`Handler Error: /api/files/:source/:owner/:project/:pathBase64/:analysisType`, error);
        return res.status(500).send('Internal Server Error');
    }
});

app.post(`${api_root_endpoint}/files/:source/:owner/:project/:pathBase64/:analysisType`, async (req, res) => {
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
        console.error(`Handler Error: /api/files/:source/:owner/:project/:pathBase64/:analysisType`, error);
        return res.status(500).send('Internal Server Error');
    }
});

app.get("/test", (req, res, next) => {
    // Set the content type to text
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Write initial part of the response
    res.write("Hello ");

    // Use a setInterval to send data in intervals
    const intervalId = setInterval(() => {
        res.write("world ");
    }, 1000); // Sends "world " every second

    // Stop sending data after 5 seconds
    setTimeout(() => {
        clearInterval(intervalId);
        res.end("Goodbye!"); // End the response with a final message
    }, 5000);
});

module.exports.handler = serverless(app);