import { Generator, GeneratorProcessingError } from './generator';
import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Services } from '../boost-python-api/endpoints';
import { signedAuthHeader } from '../auth';

enum BlueprintStage {
    Default = 'Default',
    FileScan = 'File Scan',
    SampledCode = 'Sampled Code',
    // TODO: Add more thorough blueprint
    //    - Sample files identified in Chat
    //    - Sample files for key architectural areas (auth, data, UI, etc)
    Complete = 'Complete'

}

interface DraftBlueprintInput {
    filelist: string[];
    projectName: string;
}

interface DraftBlueprintOutput {
    draftBlueprint: string;
    recommendedListOfFilesToExcludeFromAnalysis: string[];
    prioritizedListOfSourceFilesToAnalyze: string[];
    recommendedSampleSourceFile: string;
    recommendedProjectDeploymentFile: string;
}

export class BlueprintGenerator extends Generator {
    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData) {
        super(serviceEndpoint, email, projectData, ProjectDataType.ArchitecturalBlueprint);
    }

    readonly sampleBlueprint =
`## Architectural Blueprint Summary for: {projectName}
* Software Project Type: web app, server code, cloud web service, mobile app, shared library, etc.
* High-Level Summary: Short summary of software project in a 2-3 sentences
* Programming Languages: List of programming languages used in project
* Test / Quality Strategy: Unit-tests, functional tests, test framework, and test language
* Software Principles: multi-threaded, event-driven, data transformation, server processing, client app code, etc
* Data Storage: shared memory, disk, database, SQL vs NoSQL, non-persisted, data separated from code
* Software Licensing: Commercial & Non-Commercial licenses, Open Source licenses (BSD, MIT, GPL, LGPL, Apache, etc.). Identify conflicting licenses.
* Security Handling: encrypted vs non-encrypted data, memory buffer management, shared memory protections, all input is untrusted or trusted
* Performance characteristics: multi-threaded, non-blocking code, extra optimized, background tasks, CPU bound processing, etc.
* Software resiliency patterns: fail fast, parameter validation, defensive code, error logging, etc.
* Analysis of the architectural soundness and best practices: code is consistent with its programming language style, structure is consistent with its application or server framework
* Architectural Problems Identified: coarse locks in multi-threaded, global and shared memory in library, UI in a non-interactive server, versioning fragility, etc.`

readonly defaultBlueprint =
`## Architectural Blueprint Summary for: {projectName}
* Software Project Type: Unknown
* High-Level Summary: A software project
* Programming Languages: Not yet determined
* Test / Quality Strategy: Not yet determined
* Software Principles: Not yet determined
* Data Storage: Not yet determined
* Software Licensing: Not yet determined
* Security Handling: Not yet determined
* Performance characteristics: Not yet determined
* Software resiliency patterns: Not yet determined
* Analysis of the architectural soundness and best practices: Not yet determined
* Architectural Problems Identified: Not yet determined`

    async generate(stage?: string) : Promise<string> {

        if (!stage) {
            stage = BlueprintStage.Complete;
        }

        let nextStage;
        switch (stage) {
        case BlueprintStage.Complete:
        case BlueprintStage.Default:
            await this.updateProgress('Generating Default Blueprint');
            this.data = this.defaultBlueprint.replace('{projectName}', this.projectData.name);

            nextStage = BlueprintStage.FileScan;

            break;
        case BlueprintStage.FileScan:
            await this.updateProgress('Scanning Files');

            const fileList = await this.getFilenameList();

            const draftOutput : DraftBlueprintOutput = await this.draftBlueprint(fileList);

            this.data = this.sampleBlueprint;

            // we're going to save our resulting data, so we can run sampled code
            await this.saveScratchData(JSON.stringify(draftOutput));

            nextStage = BlueprintStage.SampledCode;
            break;
        case BlueprintStage.SampledCode:
            await this.updateProgress('Sampling Project Code');

            const loadedDraftOutputRaw = await this.loadScratchData();
            if (!loadedDraftOutputRaw) {
                throw new GeneratorProcessingError('Unable to load draft data', BlueprintStage.FileScan);
            }

            const loadedDraftOutput : DraftBlueprintOutput = JSON.parse(loadedDraftOutputRaw);

            nextStage = BlueprintStage.Complete;
            break;
        default:
            throw new Error(`Invalid Blueprint Stage: ${stage}`);
        }
        await this.save();

        await this.updateProgress('Finished Stage ' + stage);

        return nextStage;
    }

    async getFilenameList() : Promise<string[]> {
        const encodedUri = encodeURIComponent(this.projectData.resources[0].uri);
        const response = await fetch(this.serviceEndpoint + `/api/get_resource_files?${encodedUri}`, {
            method: 'GET',
            headers: await signedAuthHeader(this.email)
        });
        if (response.ok) {
            return await response.json() as Promise<string[]>;
        }
        throw new Error(`Unable to get file list: ${response.status}`);
    }

    async draftBlueprint(fileList: string[]) : Promise<DraftBlueprintOutput> {
        const draftInput : DraftBlueprintInput = {
            filelist: fileList,
            projectName: this.projectData.name
        };
        const response = await fetch(this.serviceEndpoint + `/api/ai/${this.projectData.org}/${Services.DraftBlueprint}`, {
            method: 'POST',
            headers: await signedAuthHeader(this.email),
            body: JSON.stringify(draftInput)
        });
        if (!response.ok) {
            throw new Error(`Unable to draft blueprint: ${response.status}`);
        }
        return response.json() as Promise<DraftBlueprintOutput>;
    }
}