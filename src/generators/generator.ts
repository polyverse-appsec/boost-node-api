import { ProjectDataType } from "../types/ProjectData";
import { UserProjectData } from "../types/UserProjectData";
import { GeneratorState, TaskStatus } from "../types/GeneratorState";
import { signedAuthHeader } from "../auth";


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

    async save() : Promise<void> {
        const authHeader = await signedAuthHeader(this.email);
        await fetch(this.resourceUri, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...authHeader
            },
            body: this.data
        });
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

    get resourceUri() : string {
        const resourceUri : URL = new URL(`${this.serviceEndpoint}/api/${this.projectData.org}/${this.projectData.name}/data/${this.data}`);
        return resourceUri.href;
    }
}