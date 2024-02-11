import { ProjectDataType } from "../types/ProjectData";
import { UserProjectData } from "../types/UserProjectData";
import { GeneratorState, TaskStatus } from "../types/GeneratorState";
import { signedAuthHeader } from "../auth";
import { saveProjectDataResource, loadProjectDataResource } from "..";
import { FileContent } from "../github";
import { Stages } from "../types/GeneratorState";
import { localSelfDispatch } from "../utility/dispatch";
import axios from "axios";

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

    get validStages() : string[] {
        throw new Error('validStages not implemented');
    }

    async generate(stage?: string): Promise<string> {

        if (!stage) {
            stage = await this.loadCurrentStageFromGenerator();
        } else if (stage === Stages.Complete) {
            console.log(`${this.projectData.org}:${this.projectData.name} ${this.dataType} Generator already complete`);
            return stage;
        }

        this.currentStage = stage;

        if (this.currentStage === Stages.Reset) {
            console.info(`${this.projectData.org}:${this.projectData.name} ${this.dataType} Generator resetting data`);
            this.currentStage = Stages.StaticDefault;
        }
        // make sure the current stage is a valid Stages or valid stage for this generator
        else if (!(Object.values(Stages).filter(value => typeof value === 'string') as string[]).includes(this.currentStage) &&
                 !(this.validStages.filter(value => typeof value === 'string') as string[]).includes(this.currentStage)) {
            throw new GeneratorProcessingError(`${this.projectData.org}:${this.projectData.name} Invalid Stage: ${this.currentStage}`, Stages.Reset);
        }

        // run the generator for this stage
        const nextStage = await this.onGenerate(this.currentStage);

        if (!nextStage) {
            throw new Error(`Missing next Stage Defined from Stage:${this.currentStage} for ${this.projectData.org}:${this.projectData.name} ${this.dataType} Generator`);
        }

        if (this.data) {
            await this.save();
        } else {
            console.debug(`${this.projectData.org}:${this.projectData.name} ${this.dataType} No Data Generated - Skipping Save`);
        }
        await this.updateProgress('Finished Stage ' + stage);

        return nextStage;
    }

    protected async onGenerate(stage: string): Promise<string> {
        throw new Error('onGenerate not implemented');
    }

    async loadCurrentStageFromGenerator() : Promise<string> {
        try {
            const generatorState : GeneratorState = await localSelfDispatch<GeneratorState>(
                this.email, '', this.serviceEndpoint, `user_project/${this.projectData.org}/${this.projectData.name}/data/${this.dataType}/generator`, 'GET');
            if (!generatorState?.stage) {
                // if the generator doesn't exist, then we'll start from the beginning
                return Stages.Reset;
            }
            return generatorState.stage;
        } catch (err) {
            if (axios.isAxiosError(err) && (err?.status === 404 || err.response?.status === 404)) {
                // if the generator doesn't exist, then we'll start from the beginning
                return Stages.Reset;
            }
            throw err;
        }
    }

    async load() : Promise<void> {
        if (process.env.TRACE_LEVEL) {
            console.log(`${this.projectData.name}:${this.projectData.org} Generator Loading ${this.dataType} data`);
        }

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
            throw new Error(`Unable to Load Generated Resource ${this.resourceUri}: ${response.status} - ${errorText}`);
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

    async saveScratchData<T>(data: T, stage?: string) : Promise<void> {
        if (process.env.TRACE_LEVEL) {
            console.log(`Saving Scratch ${this.dataType} data`);
        }

        const uri = new URL(this.projectData.resources[0].uri);
        const pathSegments = uri.pathname.split('/').filter(segment => segment);
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }

        // save as current stage if not defined
        if (!stage) {
            stage = this.currentStage;
        }
        if (!stage) {
            throw new Error('Stage not defined');
        }

        const serializedData = JSON.stringify(data);

        // write the scratch data for the current stage
        await saveProjectDataResource(
            this.email, ownerName, repoName, this.dataType,
            `${this.dataType}/generators/scratch/${stage}`,
            serializedData);
    }

    async loadScratchData<T>(stage?: string) : Promise<T | undefined> {
        if (process.env.TRACE_LEVEL) {
            console.log(`Saving Scratch ${this.dataType} data`);
        }
        const uri = new URL(this.projectData.resources[0].uri);
        const pathSegments = uri.pathname.split('/').filter(segment => segment);
        const repoName = pathSegments.pop();
        const ownerName = pathSegments.pop();
        if (!repoName || !ownerName) {
            throw new Error(`Invalid URI: ${uri}`);
        }
        if (!stage && !this.currentStage) {
            throw new Error('Stage not defined');
        }

        // write the scratch data for the current stage or a different stage
        const data = await loadProjectDataResource(
            this.email, ownerName, repoName, this.dataType,
            `${this.dataType}/generators/scratch/${stage?stage:this.currentStage}`);
        if (!data) {
            console.log(`No Scratch ${this.dataType} data found in stage ${stage?stage:this.currentStage} via Loads`);
            return undefined;
        }

        return JSON.parse(data) as T;
    }

    async save() : Promise<void> {
        if (process.env.TRACE_LEVEL) {
            console.log(`Saving ${this.dataType} data`);
        }
        
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
            throw new Error(`Unable to Save Generated Resource (size:${this.data.length} bytes): ${response.status} - ${errorText}`);
        }

        if (process.env.TRACE_LEVEL) {
            console.log(`Saved ${this.dataType} data of size ${this.data.length}`);
        }
    }

    async updateProgress(statusUpdate: string) : Promise<void> {
        const state: GeneratorState = {
            lastUpdated: Math.floor(Date.now() / 1000),
            status: TaskStatus.Processing,
            status_details: statusUpdate
        }

        if (!this.currentStage) {
            throw new Error('Current Stage not defined');
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
            if (response.status === 404) {
                if (process.env.TRACE_LEVEL) {
                    console.warn(`Generator not found - ignoring progress update: ${JSON.stringify(state)}`);
                }
            } else {
                const errorText = await response.text() || 'Unknown Error';
                console.error(`Unable to update ${this.dataType} resource generator progress: ${JSON.stringify(state)} - ${response.status} - ${errorText}`);
            }
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
        const fullSourcePath = `user/${this.projectData.org}/connectors/github/fullsource?uri=${encodedUri}`;

        try {
            const fileContentList : FileContent[] = await localSelfDispatch<FileContent[]>(
                this.email, '', this.serviceEndpoint, fullSourcePath, 'GET');

            console.debug(`Got project source: ${fileContentList.length} files`);
            
            return fileContentList;

        } catch (err) {
            console.error(`Unable to get project source: ${err}`);
            throw err;
        }
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
            console.error(`Unable to get filtered file list for ${this.resourceUri}: ${err}`);
            throw err;
        }
    }
}