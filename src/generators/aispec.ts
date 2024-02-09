import { Generator, GeneratorProcessingError } from './generator';
import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Stages } from '../types/GeneratorState';
import { FileContent } from '../github';
import { AIResponse } from '../boost-python-api/AIResponse';
import { Services } from '../boost-python-api/endpoints';
import { signedAuthHeader } from '../auth';
const ignore = require('ignore');

enum ArchitecturalSpecificationStage {
    ProjectInfo= 'Default',
    FileFiltering = 'Identifying Files for Summarization',
    FileSummarization = 'Summarization of Files using AI',
}

interface SummarizerInput {
    code: string;
}

interface SummarizerOutput extends AIResponse {
    analysis: string;
}

interface FileSummarizationStatus {
    numberOfErrors: number;
    currentErrorStreak: number;
    totalFiles: number;
    filesProcessed: number;
}

export class ArchitecturalSpecificationGenerator extends Generator {
    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData) {
        super(serviceEndpoint, email, projectData, ProjectDataType.ProjectSpecification);
    }

    readonly defaultArchitecturalSpecification =
        `# Summary for {projectName}:\n\n\n`

    readonly fileArchitecturalSpecificationEntry =
        `# Summary for {relativeFileName}:\n{architecturalSpec}\n\n`

    async onGenerate(stage: string) : Promise<string> {

        const NoSpecificationAvailable = 'No AI Specification available';
        const ErrorGeneratingSpecification = 'Unable to generate AI Specification';

        let nextStage : string = "";
        switch (stage) {
        case Stages.Initialize:
        case ArchitecturalSpecificationStage.ProjectInfo:
            await this.updateProgress('Generating Initial Project Info');
            this.data = this.defaultArchitecturalSpecification
                .replace('{projectName}', this.projectData.name)
                .replace('{projectRepo}', this.projectData.resources[0].uri);

            nextStage = ArchitecturalSpecificationStage.FileFiltering;

            break;

        case ArchitecturalSpecificationStage.FileFiltering:
        {
            await this.updateProgress('Importing Full Project Source');

            // now we'll go back and update the file contents
            const fileContents : FileContent[] = await this.getProjectSource();


            // we're going to start empty file contents to be fast, then we'll
            //      update the contents later
            const boostIgnoreFileSpecs = await this.getBoostIgnoreFileSpecs();
            const boostIgnore = ignore().add(boostIgnoreFileSpecs);

            await this.updateProgress('Filtering File Paths for .boostignore');

            const filteredFileContents : FileContent[] = [];

            for (const fileContent of fileContents) {
                if (boostIgnore.ignores(fileContent.path)) {
                    continue;
                }

                filteredFileContents.push(fileContent);
            }

            for (const fileContent of filteredFileContents) {
                this.data += this.fileArchitecturalSpecificationEntry
                    .replace('{relativeFileName}', fileContent.path)
                    .replace('{architecturalSpec}', NoSpecificationAvailable);
            }

            await this.saveScratchData<FileContent[]>(filteredFileContents);

            // reset the summarization status
            const fileSummarizationStatus : FileSummarizationStatus = {
                numberOfErrors: 0,
                currentErrorStreak: 0,
                totalFiles: filteredFileContents.length,
                filesProcessed: 0,
            };
            await this.saveScratchData<FileSummarizationStatus>(fileSummarizationStatus, ArchitecturalSpecificationStage.FileSummarization);

            nextStage = ArchitecturalSpecificationStage.FileSummarization;
            break;
        }
        case ArchitecturalSpecificationStage.FileSummarization:
        {
            await this.updateProgress('Loading Filtered File Contents');

            const filteredFileContents = await this.loadScratchData<FileContent[]>(ArchitecturalSpecificationStage.FileFiltering);
            if (!filteredFileContents) {
                throw new GeneratorProcessingError(
                    `Unable to load filtered file contents from previous stage`,
                    ArchitecturalSpecificationStage.FileFiltering);
            }

            if (filteredFileContents.length === 0) {
                nextStage = Stages.Complete;
            }

            if (!nextStage) {
                // remove the first file from the file source list - to process
                const fileContent : FileContent | undefined = filteredFileContents.shift();
                if (!fileContent) {
                    nextStage = Stages.Complete;
                }

                    // re-save the filtered file contents (without the newest entry)
                await this.saveScratchData<FileContent[]>(filteredFileContents, ArchitecturalSpecificationStage.FileFiltering);

                await this.load(); // load the resource data before updating it

                if (!nextStage) {

                    const unavailableSpecForThisFile = this.fileArchitecturalSpecificationEntry
                        .replace('{relativeFileName}', fileContent!.path)
                        .replace('{architecturalSpec}', NoSpecificationAvailable)

                    const fileSummarizationStatus = await this.loadScratchData<FileSummarizationStatus>(ArchitecturalSpecificationStage.FileSummarization);
                    if (!fileSummarizationStatus) {
                        throw new GeneratorProcessingError(
                            `Unable to load file summarization status from previous stage`,
                            ArchitecturalSpecificationStage.FileFiltering);
                    }

                    try {
                        await this.updateProgress('Building AI Specification for ' + fileContent!.path);

                        const architecturalSpec : string = await this.createArchitecturalSpecification(fileContent!.source);
                        
                        fileSummarizationStatus.filesProcessed++;

                        const availableSpecForThisFile = this.fileArchitecturalSpecificationEntry
                                .replace('{relativeFileName}', fileContent!.path)
                                .replace('{architecturalSpec}', architecturalSpec);

                        this.data = this.data.replace(unavailableSpecForThisFile, availableSpecForThisFile);

                    } catch (err: any) {
                        console.log(`Error creating architectural specification for ${fileContent!.path}: ${err}`);

                        fileSummarizationStatus.numberOfErrors++;
                        fileSummarizationStatus.currentErrorStreak++;
                
                        await this.checkAndSetErrorState(fileSummarizationStatus, err);

                        const errorSpecificationForThisFile = this.fileArchitecturalSpecificationEntry
                                .replace('{relativeFileName}', fileContent!.path)
                                .replace('{architecturalSpec}', ErrorGeneratingSpecification)

                        this.data = this.data.replace(unavailableSpecForThisFile, errorSpecificationForThisFile);

                        await this.updateProgress(`Failed to Build AI Spec for ${fileContent!.path} due to ${err}`);
                    }

                    await this.saveScratchData<FileSummarizationStatus>(fileSummarizationStatus, ArchitecturalSpecificationStage.FileSummarization);

                    // if there are no more files to process, we're done
                    if (filteredFileContents.length === 0) {
                        nextStage = Stages.Complete;
                    } else {
                        nextStage = ArchitecturalSpecificationStage.FileSummarization;
                    }
                }
            }
            break;
        }
        default:
            throw new Error(`Invalid Generator: ${this.resourceUri} Stage: ${stage}`);
        }

        return nextStage;
    }

    async checkAndSetErrorState(fileSummarizationStatus: FileSummarizationStatus, err: Error) : Promise<void> {

        // if we have 5 errors in a row, we'll abort and retry later - assume major network glitch
        if (fileSummarizationStatus.currentErrorStreak > 5) {
            throw new GeneratorProcessingError(
                `Too many errors creating architectural specifications: ${fileSummarizationStatus.currentErrorStreak} errors in a row`,
                ArchitecturalSpecificationStage.FileSummarization);
        }

        // if we have higher than 25% errors, we'll abort and retry
        //    we throw here - which marks the generator in error state with reason, and enables
        //    caller or groomer to restart this stage
        // For very small projects (less than 10 files), we'll be less tolerant of errors
        //    since a couple errors can dramatically skew the results
        else if (fileSummarizationStatus.totalFiles > 10) {
            if (fileSummarizationStatus.numberOfErrors > (fileSummarizationStatus.totalFiles / 4)) {
                throw new GeneratorProcessingError(
                    `Too many errors creating architectural specifications: ${fileSummarizationStatus.numberOfErrors} errors out of ${fileSummarizationStatus.totalFiles} files`,
                    ArchitecturalSpecificationStage.FileSummarization);
            }
        } else if (fileSummarizationStatus.numberOfErrors > 2) {
            throw new GeneratorProcessingError(
                `Too many errors creating architectural specifications: ${fileSummarizationStatus.numberOfErrors} errors out of ${fileSummarizationStatus.totalFiles} files`,
                ArchitecturalSpecificationStage.FileSummarization);
        }
    }

    async createArchitecturalSpecification(code: string) : Promise<string> {
        const inputData : SummarizerInput = {
            code: code,
        };
        const response = await fetch(this.serviceEndpoint + `/api/proxy/ai/${this.projectData.org}/${Services.Summarizer}`, {
            method: 'POST',
            headers: await signedAuthHeader(this.email),
            body: JSON.stringify(inputData)
        });
        if (!response.ok) {
            console.error(`Unable to build Architectural specification: ${response.status} - processing input: ${JSON.stringify(inputData)}`);
            throw new Error(`Unable to build Architetural specification: ${response.status}`);
        }

        const objectResponseRaw = await response.json();
        const responseData : SummarizerOutput = (objectResponseRaw.body?JSON.parse(objectResponseRaw.body):objectResponseRaw) as SummarizerOutput;

        return responseData.analysis;
    }
}