import { Generator, GeneratorProcessingError } from './generator';
import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Stages } from '../types/GeneratorState';
import { FileContent } from '../github';
import { AIResponse } from '../boost-python-api/AIResponse';
import { Services } from '../boost-python-api/endpoints';
import { signedAuthHeader } from '../auth';
import { localSelfDispatch } from '../utility/dispatch';
const ignore = require('ignore');

enum ArchitecturalSpecificationStage {
    FileFiltering = 'Identifying Files for Summarization',
    FileSummarization = 'Summarization of Files using AI',
}

interface SummarizerInput {
    code: string;
    filepath: string;
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

    get validStages() : string[] {
        return Object.values(ArchitecturalSpecificationStage);
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
        case Stages.StaticDefault:
            await this.updateProgress('Generating Initial Project Info');

            const projectRepos: string = this.projectData.resources.map((resource) => resource.uri).join('\n\n');
            this.data = this.defaultArchitecturalSpecification
                .replace('{projectName}', this.projectData.name)
                .replace('{projectRepo}', projectRepos);

            nextStage = ArchitecturalSpecificationStage.FileFiltering;

            if (process.env.AI_SPEC_SKIPPED) {
                nextStage = Stages.Complete; // short-circuit for testing
            }
            
            break;

        case ArchitecturalSpecificationStage.FileFiltering:
        {
            await this.updateProgress('Importing Full Project Source');

            // now we'll go back and update the file contents
            const fileContents : FileContent[] = await this.getProjectSource();

            // we're going to start by saving empty file contents to be fast,
            //  then we'll update the contents later
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
                return nextStage;
            }

            // remove the first file from the file source list - to process
            if (!Array.isArray(filteredFileContents)) {
                throw new GeneratorProcessingError(
                    `Filtered file contents is not an array`,
                    ArchitecturalSpecificationStage.FileFiltering);
            }
            const fileContent : FileContent | undefined = filteredFileContents.shift();
            if (!fileContent) {
                nextStage = Stages.Complete;
                return nextStage;
            }

            try {
                if (!fileContent?.path) {
                    console.warn(`File content missing path - skipping AI spec gen`);
                    return ArchitecturalSpecificationStage.FileSummarization;
                }
                if (!fileContent?.source) {
                    console.warn(`File content missing source - skipping AI spec gen for ${fileContent.path}`);
                    return ArchitecturalSpecificationStage.FileSummarization;
                }
            } finally {
                    // re-save the filtered file contents (without the newest entry)
                await this.saveScratchData<FileContent[]>(filteredFileContents, ArchitecturalSpecificationStage.FileFiltering);
            }

            await this.load(); // load the resource data before updating it

            const unavailableSpecForThisFile = this.fileArchitecturalSpecificationEntry
                .replace('{relativeFileName}', fileContent.path)
                .replace('{architecturalSpec}', NoSpecificationAvailable)

            const fileSummarizationStatus = await this.loadScratchData<FileSummarizationStatus>(ArchitecturalSpecificationStage.FileSummarization);
            if (!fileSummarizationStatus) {
                throw new GeneratorProcessingError(
                    `Unable to load file summarization status from previous stage`,
                    ArchitecturalSpecificationStage.FileFiltering);
            }

            try {
                await this.updateProgress('Building AI Specification for ' + fileContent.path);

                const architecturalSpec : string = await this.createArchitecturalSpecification(fileContent.path, fileContent.source);
                
                fileSummarizationStatus.filesProcessed++;

                const availableSpecForThisFile = this.fileArchitecturalSpecificationEntry
                        .replace('{relativeFileName}', fileContent.path)
                        .replace('{architecturalSpec}', architecturalSpec);

                this.data = this.data.replace(unavailableSpecForThisFile, availableSpecForThisFile);

            } catch (err: any) {
                console.log(`Error creating architectural specification for ${fileContent.path}: ${err}`);

                fileSummarizationStatus.numberOfErrors++;
                fileSummarizationStatus.currentErrorStreak++;
        
                await this.checkAndSetErrorState(fileSummarizationStatus, err);

                const errorSpecificationForThisFile = this.fileArchitecturalSpecificationEntry
                        .replace('{relativeFileName}', fileContent.path)
                        .replace('{architecturalSpec}', ErrorGeneratingSpecification)

                this.data = this.data.replace(unavailableSpecForThisFile, errorSpecificationForThisFile);

                await this.updateProgress(`Failed to Build AI Spec for ${fileContent!.path} due to ${err}`);
            }

            await this.saveScratchData<FileSummarizationStatus>(fileSummarizationStatus, ArchitecturalSpecificationStage.FileSummarization);

            // if there are no more files to process, we're done
            if (filteredFileContents.length === 0) {
                nextStage = Stages.Complete;
            } else {
                if (process.env.ONE_AI_SPEC) {
                    console.warn(`Processing ONE AI Spec for testing only`);
                    nextStage = Stages.Complete; // short-circuit after one spec for testing
                } else {
                    nextStage = ArchitecturalSpecificationStage.FileSummarization;
                }
            }
            break;
        }
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

    async createArchitecturalSpecification(filepath: string, code: string) : Promise<string> {
        const inputData : SummarizerInput = {
            code: code,
            filepath: filepath
        };

        try {
            const summarizerOutput : SummarizerOutput = await localSelfDispatch<SummarizerOutput>(
                this.email, '', this.serviceEndpoint, `proxy/ai/${this.projectData.org}/${Services.Summarizer}`, 'POST',
                inputData);
            return summarizerOutput.analysis;

        } catch (err) {
            console.error(`Unable to build Architectural specification: ${err} - processing input: ${JSON.stringify(inputData)}`);
            throw new Error(`Unable to build Architetural specification: ${err}`);
        }
    }
}