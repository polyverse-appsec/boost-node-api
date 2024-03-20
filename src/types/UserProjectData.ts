import { ProjectResource } from "./ProjectResource";

export enum DiscoveryTrigger {
    ProjectUpdate = "ProjectCreation",
    UserManual = "UserManual",
    AutomaticGrooming = "AutomaticGrooming",
}

export interface UserProjectData {
    org : string,
    name : string,
    owner? : string,
    description? : string,
    title?: string,
    // guidelines are a keyed list of guidelines for the project
    guidelines? : Record<string, string>[],
    resources : ProjectResource[],
    lastUpdated : number,
}