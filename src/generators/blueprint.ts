import { Generator, GeneratorProcessingError } from './generator';
import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Services } from '../boost-python-api/endpoints';
import { signedAuthHeader } from '../auth';
import { Stages } from '../types/GeneratorState';
import { AIResponse }  from '../boost-python-api/AIResponse';
import { AIFunctionResponse } from '../boost-python-api/AIFunctionResponse';
import path from 'path';

enum BlueprintStage {
    Default = 'Default',
    FileImport = 'File Import',
    SourceLanguageScan = 'Source Language Scan',
    FileScan = 'File Scan',
    SampledCode = 'Sampled Code',
    BuildingBlueprint = 'Building Blueprint'
    // TODO: Add more thorough blueprint
    //    - Sample files identified in Chat
    //    - Sample files for key architectural areas (auth, data, UI, etc)
}

interface DraftBlueprintInput {
    filelist: string[];
    projectName: string;
}

interface DraftBlueprintOutput {
    draftBlueprint: string;
    recommendedListOfFilesToExcludeFromAnalysis: string[];
    prioritizedListOfSourceFilesToAnalyze: string[];
    recommendedSampleSourceFile?: string;
    recommendedProjectDeploymentFile?: string;
}

interface QuickBlueprintInput {
    draftBlueprint: string;
    filelist: string[];
    projectName: string;

    projectFile?: string;
    code?: string;
}

interface QuickBlueprintOutput extends AIResponse {
    blueprint: string;
}

export class BlueprintGenerator extends Generator {
    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData) {
        super(serviceEndpoint, email, projectData, ProjectDataType.ArchitecturalBlueprint);
    }

    readonly staticBlueprint =
`## Architectural Blueprint Summary for: {projectName}
* The architecture of the software project is defined in the source code summary documents.`;

    readonly staticBlueprintWithFilenames =
`## Architectural Blueprint Summary for: {projectName}
* The architecture of the software project is defined in the source code summary documents.
* The majority of the source code is written in Programming Language with file extension {mostCommonFileExtension}`;

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

    async onGenerate(stage: string) : Promise<string> {
        let nextStage;
        switch (stage) {
        case Stages.Initialize:
        case BlueprintStage.Default:
            await this.updateProgress('Generating Default Blueprint');
            this.data = this.defaultBlueprint.replace('{projectName}', this.projectData.name);

            nextStage = BlueprintStage.FileImport;

            break;

        case BlueprintStage.FileImport:
        {
            const filteredFileList : string[] = await this.getFilteredFileList();

            // we're going to save our resulting data, so we can run sampled code
            await this.saveScratchData<string[]>(filteredFileList, BlueprintStage.FileImport);

            nextStage = BlueprintStage.SourceLanguageScan;

            break;
        }

        case BlueprintStage.SourceLanguageScan:
        {
            const filteredFileList : string[] | undefined = await this.loadScratchData<string[]>(BlueprintStage.FileImport);
            if (!filteredFileList) {
                throw new GeneratorProcessingError('Unable to load file list', BlueprintStage.FileImport);
            }

            const mostCommonFileExtension = this.getMostCommonFileExtension(filteredFileList);
            this.data =
                this.staticBlueprintWithFilenames
                    .replace('{projectName}', this.projectData.name)
                    .replace('{mostCommonFileExtension}', mostCommonFileExtension);

            if (process.env.AI_BLUEPRINT) {
                nextStage = BlueprintStage.FileScan;

                // if we don't want to incur the cost of AI analysis (e.g. draft blueprint)
                //    then we'll skip it completely and just use the static blueprint
            } else {
                nextStage = Stages.Complete;
            }

            break;
        }

        case BlueprintStage.FileScan:
        {
            const filteredFileList : string[] | undefined = await this.loadScratchData<string[]>(BlueprintStage.FileImport);
            if (!filteredFileList) {
                throw new GeneratorProcessingError('Unable to load file list', BlueprintStage.FileImport);
            }

            await this.updateProgress('Analyzing Files with AI');

            const draftOutput : DraftBlueprintOutput = await this.createDraftBlueprint(filteredFileList);

            // we're going to save our resulting data, so we can run sampled code
            await this.saveScratchData<DraftBlueprintOutput>(draftOutput, BlueprintStage.FileScan);

            this.data = draftOutput.draftBlueprint;

            nextStage = BlueprintStage.SampledCode;
            break;
        }

        case BlueprintStage.SampledCode:
        {
            await this.updateProgress('Sampling Project Code');

            const draftOutput = await this.loadScratchData<DraftBlueprintOutput>(BlueprintStage.FileScan);
            if (!draftOutput) {
                // if we don't have the data we need from the draft blueprint process, we won't be able
                //      to build a better sampled code blueprint - so reset back to file scan to try and
                //      generate it again
                throw new GeneratorProcessingError('Unable to load draft data', BlueprintStage.FileScan);
            }

            await this.load(); // load the resource data before re-processing it

            const inputData : QuickBlueprintInput = {
                draftBlueprint: this.data,
                filelist: draftOutput.prioritizedListOfSourceFilesToAnalyze,
                projectName: this.projectData.name,
            }

            if (draftOutput.recommendedSampleSourceFile) {
                await this.updateProgress('Sampling Project Source Files');

                const code = await this.loadProjectFile(draftOutput.recommendedSampleSourceFile);
                if (code) {
                    inputData.code = code;
                }
            }
            if (draftOutput.recommendedProjectDeploymentFile) {
                await this.updateProgress('Sampling Project Deployment Configuration');

                const projectFile = await this.loadProjectFile(draftOutput.recommendedProjectDeploymentFile);
                if (projectFile) {
                    inputData.projectFile = projectFile;
                }
            }
            if (!inputData.code && !inputData.projectFile) {
                throw new GeneratorProcessingError('Unable to load project files', BlueprintStage.FileScan);
            } else if (!inputData.code) {
                console.error('Unable to find code file, using project file only');
                inputData.code = 'No Code Provided';
            } else if (!inputData.projectFile) {
                console.error('Unable to find project file, using code only');
                inputData.projectFile = 'No Project File Provided';
            }

            await this.saveScratchData<QuickBlueprintInput>(inputData, BlueprintStage.SampledCode);

            nextStage = BlueprintStage.BuildingBlueprint;

            break;
        }
        case BlueprintStage.BuildingBlueprint:
        {

            await this.updateProgress('Rebuilding Blueprint from Sampled Project Files');

            const inputData = await this.loadScratchData<QuickBlueprintInput>(BlueprintStage.SampledCode);
            if (!inputData) {
                // if we don't have the data we need from the draft blueprint process, we won't be able
                //      to build a better sampled code blueprint - so reset back to find the code samples
                throw new GeneratorProcessingError('Unable to load sampled code data', BlueprintStage.SampledCode);
            }

            this.data = await this.createSampledCodeBlueprint(inputData);

            nextStage = Stages.Complete;
            break;
        }

        default:
            throw new Error(`Invalid Generator: ${this.resourceUri} Stage: ${stage}`);
        }

        return nextStage;
    }

    readonly ignoredTextExtensions = ['md', 'txt', 'json'];
    getMostCommonFileExtension(fileList: string[]) : string {
        const fileExtensions : {[key: string]: number} = {};
        for (const file of fileList) {
            const extension = path.extname(file).slice(1);
            if (extension) {
                // ignore text extensions (md, txt, json)
                if (this.ignoredTextExtensions.includes(extension)) {
                    continue;
                }

                if (fileExtensions[extension]) {
                    fileExtensions[extension]++;
                } else {
                    fileExtensions[extension] = 1;
                }
            } else {
                // ignore files without extensions (e.g. README, LICENSE, etc.)
                continue;
            }
        }

        let mostCommonExtension = '';
        let mostCommonCount = 0;
        for (const extension in fileExtensions) {
            if (fileExtensions[extension] > mostCommonCount) {
                mostCommonCount = fileExtensions[extension];
                mostCommonExtension = extension;
            }
        }
        if (!mostCommonExtension) {
            mostCommonExtension = 'Unknown';
        }

        return mostCommonExtension;
    }

    async createDraftBlueprint(fileList: string[]) : Promise<DraftBlueprintOutput> {
        const draftInput : DraftBlueprintInput = {
            filelist: fileList,
            projectName: this.projectData.name
        };
        const response = await fetch(this.serviceEndpoint + `/api/proxy/ai/${this.projectData.org}/${Services.DraftBlueprint}`, {
            method: 'POST',
            headers: await signedAuthHeader(this.email),
            body: JSON.stringify(draftInput)
        });
        if (!response.ok) {
            throw new Error(`Unable to draft blueprint: ${response.status}`);
        }

        const objectResponseRaw = await response.json();
        const draftOutputResponse : AIFunctionResponse = (objectResponseRaw.body?JSON.parse(objectResponseRaw.body):objectResponseRaw) as AIFunctionResponse;

        // check if the draft blueprint call succeeded, but the AI analysis failed
        if (draftOutputResponse.status !== 1) {
            throw new GeneratorProcessingError('Unable to generate draft blueprint', this.currentStage);
        }

        const draftOutput : DraftBlueprintOutput = draftOutputResponse.details;
        return draftOutput;
    }

    async createSampledCodeBlueprint(inputData: QuickBlueprintInput) : Promise<string> {
        const response = await fetch(this.serviceEndpoint + `/api/proxy/ai/${this.projectData.org}/${Services.QuickBlueprint}`, {
            method: 'POST',
            headers: await signedAuthHeader(this.email),
            body: JSON.stringify(inputData)
        });
        if (!response.ok) {
            throw new Error(`Unable to build blueprint from project samples: ${response.status}`);
        }

        const objectResponseRaw = await response.json();
        const responseData : QuickBlueprintOutput = (objectResponseRaw.body?JSON.parse(objectResponseRaw.body):objectResponseRaw) as QuickBlueprintOutput;
        return responseData.blueprint;
    }
}