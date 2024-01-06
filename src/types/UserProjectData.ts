import { ProjectResource } from "./ProjectResource";

export interface UserProjectData {
    org : string,
    name : string,
    guidelines : string,
    resources : ProjectResource[],
}