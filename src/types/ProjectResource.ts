export const enum ResourceType {
    PrimaryRead = "primary_read",       // user read-only to source
    PrimaryReadWrite = "primary_write",     // user read/write to source
    ReferenceRead = "reference_read",   // user read-only to reference
}

export const enum ResourceStatus {
    Public = "public",
    Private = "private",
    Unknown = "unknown",
    Error = "error",
}

export interface ProjectResource {
    uri: string;
    type: string;
    access: ResourceStatus;
}