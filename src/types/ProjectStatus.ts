
export enum ProjectStatus {
    Unknown = 'Unknown',                                    // project not found
    OutOfDateProjectData = 'Out of Date Project Data',      // project data out of date with source (e.g. newer source)
    ResourcesMissing = 'Resources Missing',                 // project uris found, but not resources
    // ResourcesOutOfDate = 'Resources Out of Date',        // Resources out of date with source (e.g. newer source)
    ResourcesIncomplete = 'Resources Incomplete',           // resources found, but not completely generated
    ResourcesInError = 'Resources In Error',                // resources found, but generators in error state
    ResourcesGenerating = 'Resources Generating',           // resources missing or incomplete, but still being generated
    ResourcesNotSynchronized = 'Resources Not Synchronized',// resources completely generated, but not synchronized to OpenAI
    AIResourcesOutOfDate = 'AI Data Out of Date',           // resources synchronized to OpenAI, but newer resources available
    AssistantNotAttached = 'Assistant Not Attached',        // resources synchronized to OpenAI, but no assistant attached
    AssistantOutOfDate = 'Assistant Out of Date',           // resources synchronized to OpenAI, but assistant does not include all files
    Synchronized = 'Fully Synchronized'                     // All current resources completely synchronized to OpenAI
}