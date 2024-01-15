import { ProjectDataType } from "../types/ProjectData";
import { UserProjectData } from "../types/UserProjectData";
import { GeneratorState, TaskStatus } from "../types/GeneratorState";
import { signedAuthHeader } from "../auth";
import { saveProjectDataResource, loadProjectDataResource } from "..";


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

        if (!response.ok) {
            throw new Error(`Unable to Save Generated Resource: ${response.status}`);
        }
        this.data = await response.text();

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

        await saveProjectDataResource(this.email, ownerName, repoName, this.dataType, '', this.data);

        /*
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
            throw new Error(`Unable to Save Generated Resource: ${response.status}`);
        }
        */

        console.log(`Saved ${this.dataType} data`);
    }

    async updateProgress(statusUpdate: string) : Promise<void> {
        const state: GeneratorState = {
            last_updated: Math.floor(Date.now() / 1000),
            status: TaskStatus.Processing,
            status_details: statusUpdate
        }

        const authHeader = await signedAuthHeader(this.email);
        await fetch(this.resourceUri + `/generator`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...authHeader
            },
            body: JSON.stringify(state)
        });
    }

    async loadProjectFile(filename: string) : Promise<string> {
        const authHeader = await signedAuthHeader(this.email);

        const encodedFilename = encodeURIComponent(filename);
        const response = await fetch(this.resourceUri + `/${this.projectData.org}/connectors/github/file?uri=${encodedFilename}`, {
            method: 'GET',
            headers: {
                ...authHeader
            }
        });

        // if we can't load the project file, just return an empty string - caller can decide if that's a fatal issue
        if (!response.ok) {
            console.log(`Unable to load project file: ${filename} from ${this.projectData.resources[0].uri}`);
            return '';
        }

        return await response.text();
    }

    get resourceUri() : string {
        const resourceUri : URL = new URL(`${this.serviceEndpoint}/api/${this.projectData.org}/${this.projectData.name}/data/${this.dataType}`);
        return resourceUri.href;
    }
}