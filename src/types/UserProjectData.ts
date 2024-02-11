import { ProjectResource } from "./ProjectResource";

export interface UserProjectData {
    org : string,
    name : string,
    owner? : string,
    guidelines : string,
    resources : ProjectResource[],
    lastUpdated : number,
}