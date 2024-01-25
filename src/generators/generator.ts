import { ProjectDataType } from "../types/ProjectData";
import { UserProjectData } from "../types/UserProjectData";
import { GeneratorState, TaskStatus } from "../types/GeneratorState";
import { signedAuthHeader } from "../auth";
import { saveProjectDataResource, loadProjectDataResource } from "..";
import { FileContent } from "../github";
const ignore = require('ignore');

export class GeneratorProcessingError extends Error {
    stage: string;

    constructor(message: string, stage: string) {
        super(message);
        this.name = 'GeneratorProcessingError';
        this.stage = stage;
    }
}

export class Generator {
    email: string;
    projectData: UserProjectData;
    serviceEndpoint: string;
    dataType: string;
    currentStage: string;

    data: string;

    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData, dataType: ProjectDataType) {
        this.email = email;
        this.projectData = projectData;
        this.serviceEndpoint = serviceEndpoint;
        this.dataType = dataType;
        this.currentStage = '';
        this.data = '';
    }

    async generate(stage?: string) : Promise<string> {
        throw new Error('Not implemented');
    }

    async load() : Promise<void> {
        console.log(`Loading ${this.dataType} data`);

        const authHeader = await signedAuthHeader(this.email);

        const response = await fetch(this.resourceUri, {
            method: 'GET',
            headers: {
                'Content-Type': 'text/plain',
                ...authHeader
            }
        });

        // if we got 404 Not Found, that's OK - we'll just start with an empty string
        if (response.status === 404) {
            console.log(`No ${this.dataType} data found via Load`);
            return;
        }

        if (!response.ok) {
            const errorText = await response.text() || 'Unknown Error';
            throw new Error(`Unable to Load Generated Resource: ${response.status} - ${errorText}`);
        }
        
        const dataResponseRaw = await response.text();

        // check if this is a valid JSON response (in raw text) before we look at body property
        //      since the body property is only set if the response is JSON
        //
        //      if the response is not JSON, we'll just use the raw text as the data
        const isJson = dataResponseRaw && (dataResponseRaw[0] === '{' || dataResponseRaw[0] === '[');
        if (isJson) {
            console.log(`Loaded ${this.dataType} data as JSON to extra body property`);
            const dataResponse = JSON.parse(dataResponseRaw);
            this.data = dataResponse.body?dataResponse.body:dataResponseRaw;
        } else {
            this.data = dataResponseRaw;
        }
        console.log(`Loaded ${this.dataType} data`);
    }

    async saveScratchData(data: string) : Promise<void> {
        console.log(`Saving Scratch ${this.dataType} data`);

        const uri = new URL(this.projectData.resources[0].uri);
        const pathSegments = uri.pathname.split('/').filter(segment => segment);
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        // write the scratch data for the current stage
        await saveProjectDataResource(
            this.email, ownerName, repoName, this.dataType,
            `${this.dataType}/generators/scratch/${this.currentStage}`,
            data);
    }

    async loadScratchData(stage?: string) : Promise<string | undefined> {
        console.log(`Saving Scratch ${this.dataType} data`);

        const uri = new URL(this.projectData.resources[0].uri);
        const pathSegments = uri.pathname.split('/').filter(segment => segment);
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        // write the scratch data for the current stage or a different stage
        const data = await loadProjectDataResource(
            this.email, ownerName, repoName, this.dataType,
            `${this.dataType}/generators/scratch/${stage?stage:this.currentStage}`);
        return data;
    }

    async save() : Promise<void> {
        console.log(`Saving ${this.dataType} data`);

        const uri = new URL(this.projectData.resources[0].uri);
        const pathSegments = uri.pathname.split('/').filter(segment => segment);
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        const authHeader = await signedAuthHeader(this.email);
        const response = await fetch(this.resourceUri, {
            method: 'PUT',
            headers: {
                'Content-Type': 'text/plain',
                ...authHeader
            },
            body: this.data
        });

        if (!response.ok) {
            const errorText = await response.text() || 'Unknown Error';
            throw new Error(`Unable to Save Generated Resource: ${response.status} - ${errorText}`);
        }

        console.log(`Saved ${this.dataType} data`);
    }

    async updateProgress(statusUpdate: string) : Promise<void> {
        const state: GeneratorState = {
            last_updated: Math.floor(Date.now() / 1000),
            status: TaskStatus.Processing,
            status_details: statusUpdate
        }

        console.log(`Progress Update on Stage ${this.currentStage}: ${JSON.stringify(state)}`);

        const authHeader = await signedAuthHeader(this.email);
        const response = await fetch(this.resourceUri + `/generator`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...authHeader
            },
            body: JSON.stringify(state)
        });
        if (!response.ok) {
            const errorText = await response.text() || 'Unknown Error';
            console.error(`Unable to update ${this.dataType} resource generator progress: ${JSON.stringify(state)} - ${response.status} - ${errorText}`);
        }
    }

    async loadProjectFile(filename: string) : Promise<string> {
        const authHeader = await signedAuthHeader(this.email);

        const encodedFilename = encodeURIComponent(filename);
        const encodedRepo = encodeURIComponent(this.projectData.resources[0].uri);
        const getFileEndpoint = `${this.serviceEndpoint}/api/user/${this.projectData.org}/connectors/github/file?repo=${encodedRepo}&path=${encodedFilename}`;
        const response = await fetch(getFileEndpoint, {
            method: 'GET',
            headers: {
                ...authHeader
            }
        });

        // if we can't load the project file, just return an empty string - caller can decide if that's a fatal issue
        if (!response.ok) {
            const errorText = await response.text() || 'Unknown Error';
            console.log(`Unable to load project file: ${filename} from ${this.projectData.resources[0].uri} - ${response.status} - ${errorText}`);
            return '';
        }


        const dataResponseRaw = await response.text();

        // check if this is a valid JSON response (in raw text) before we look at body property
        //      since the body property is only set if the response is JSON
        //
        //      if the response is not JSON, we'll just use the raw text as the data
        const isJson = dataResponseRaw && (dataResponseRaw[0] === '{' || dataResponseRaw[0] === '[');
        if (isJson) {
            console.log(`Loaded ${this.dataType} data as JSON to extra body property`);
            const dataResponse = JSON.parse(dataResponseRaw);
            return dataResponse.body?dataResponse.body:dataResponseRaw;
        }

        return dataResponseRaw;
    }

    get resourceUri() : string {
        const resourceUri : URL = new URL(`${this.serviceEndpoint}/api/user_project/${this.projectData.org}/${this.projectData.name}/data/${this.dataType}`);
        return resourceUri.href;
    }

    async getFilenameList() : Promise<string[]> {
        const encodedUri = encodeURIComponent(this.projectData.resources[0].uri);
        const getFilesEndpoint = this.serviceEndpoint + `/api/user/${this.projectData.org}/connectors/github/files?uri=${encodedUri}`;
        const response = await fetch(getFilesEndpoint, {
            method: 'GET',
            headers: await signedAuthHeader(this.email)
        });
        if (response.ok) {

            const objectResponseRaw = await response.json();
            const responseList : string[] = (objectResponseRaw.body?JSON.parse(objectResponseRaw.body):objectResponseRaw) as string[];

            return responseList;
        }
        const errorText = await response.text() || 'Unknown Error';
        throw new Error(`Unable to get file list: ${response.status} - ${errorText}`);
    }

    async getProjectSource() : Promise<FileContent[]> {
        const encodedUri = encodeURIComponent(this.projectData.resources[0].uri);
        const getFullSourceEndpoint = this.serviceEndpoint + `/api/user/${this.projectData.org}/connectors/github/fullsource?uri=${encodedUri}`;
        const response = await fetch(getFullSourceEndpoint, {
            method: 'GET',
            headers: await signedAuthHeader(this.email)
        });
        if (response.ok) {

            const objectResponseRaw = await response.json();
            const fileContentList : FileContent[] = (objectResponseRaw.body?JSON.parse(objectResponseRaw.body):objectResponseRaw) as FileContent[];
    
            return fileContentList;
        }
        const errorText = await response.text() || 'Unknown Error';
        throw new Error(`Unable to get project source: ${response.status} - ${errorText}`);
    }

    async getBoostIgnoreFileSpecs() : Promise<string[]> {
        const response = await fetch(this.serviceEndpoint + `/api/user_project/${this.projectData.org}/${this.projectData.name}/config/.boostignore`, {
            method: 'GET',
            headers: await signedAuthHeader(this.email)
        });
        if (response.ok) {

            const objectResponseRaw = await response.json();
            const ignoredFiles : string[] = (objectResponseRaw.body?JSON.parse(objectResponseRaw.body):objectResponseRaw) as string[];
    
            return ignoredFiles;
        }

        const errorText = await response.text() || 'Unknown Error';
        console.error(`Unable to get boostignore file specs: ${response.status} - ${errorText}`);

        // for now - if we fail to get the boostignore specs, just return an empty list since its only
        //      used to build a basic blueprint
        // throw new Error(`Unable to get boostignore file specs: ${response.status}`);
        return [];
    }

    async getFilteredFileList(): Promise<string[]> {
        await this.updateProgress('Scanning Files from GitHub Repo');

        try {
            const fileList : string[] = await this.getFilenameList();

            // need to filter the fileList based on the boostignore (similar to gitignore)
            // files in the filelist look like "foo/bar/baz.txt"
            // file specs in boost ignore look like "**/*.txt" - which should ignore all text files
            //      in all folders. Or "node_modules/" which should ignore all files in the node_modules root folder.
            //      Or ".gitignore" which should ignore file named .gitignore in the root directory
            await this.updateProgress('Filtered File List for .boostignore');
            
            const boostIgnoreFileSpecs = await this.getBoostIgnoreFileSpecs();
            const boostIgnore = ignore().add(boostIgnoreFileSpecs);
            const filteredFileList = fileList.filter((file) => !boostIgnore.ignores(file));

            return filteredFileList;
        } catch (err) {
            console.error(`Unable to get filtered file list: ${err}`);
            throw err;
        }
    }
}