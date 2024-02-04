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
    Complete = Stages.Complete,
}

interface SummarizerInput {
    code: string;
}

interface SummarizerOutput extends AIResponse {
    analysis: string;
}

export class ArchitecturalSpecificationGenerator extends Generator {
    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData) {
        super(serviceEndpoint, email, projectData, ProjectDataType.ProjectSpecification);
    }

    readonly defaultArchitecturalSpecification =
        `# Summary for {projectName}:\n\n\n`

    readonly fileArchitecturalSpecificationEntry =
        `# Summary for {relativeFileName}:\n{architecturalSpec}\n\n`

    async generate(stage?: string) : Promise<string> {

        if (!stage) {
            stage = ArchitecturalSpecificationStage.Complete;
        }

        const NoSpecificationAvailable = 'No AI Specification available';
        const ErrorGeneratingSpecification = 'Unable to generate AI Specification';

        let nextStage : string = "";
        switch (stage) {
        case ArchitecturalSpecificationStage.Complete:
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

            await this.saveScratchData(JSON.stringify(filteredFileContents));

            nextStage = ArchitecturalSpecificationStage.FileSummarization;
            break;
        }
        case ArchitecturalSpecificationStage.FileSummarization:
        {
            await this.updateProgress('Loading Filtered File Contents');

            const loadedFilteredFileContentsRaw = await this.loadScratchData(ArchitecturalSpecificationStage.FileFiltering);
            if (!loadedFilteredFileContentsRaw) {
                throw new GeneratorProcessingError(
                    `Unable to load filtered file contents from previous stage`,
                    ArchitecturalSpecificationStage.FileFiltering);
            }

            const filteredFileContents : FileContent[] = JSON.parse(loadedFilteredFileContentsRaw);

            if (filteredFileContents.length === 0) {
                nextStage = ArchitecturalSpecificationStage.Complete;
            }

            if (!nextStage) {
                // remove the first file from the file source list - to process
                const fileContent : FileContent | undefined = filteredFileContents.shift();
                if (!fileContent) {
                    nextStage = ArchitecturalSpecificationStage.Complete;
                }

                    // re-save the filtered file contents (without the newest entry)
                await this.saveScratchData(JSON.stringify(filteredFileContents), ArchitecturalSpecificationStage.FileSummarization);

                if (!nextStage) {

                    const unavailableSpecForThisFile = this.fileArchitecturalSpecificationEntry
                        .replace('{relativeFileName}', fileContent!.path)
                        .replace('{architecturalSpec}', NoSpecificationAvailable)

                    try {
                        await this.updateProgress('Building AI Specification for ' + fileContent!.path);

                        const architecturalSpec : string = await this.createArchitecturalSpecification(fileContent!.source);

                        const availableSpecForThisFile = this.fileArchitecturalSpecificationEntry
                                .replace('{relativeFileName}', fileContent!.path)
                                .replace('{architecturalSpec}', architecturalSpec);

                        this.data.replace(unavailableSpecForThisFile, availableSpecForThisFile);

                    } catch (err) {
                        console.log(`Error creating architectural specification for ${fileContent!.path}: ${err}`);

                        const errorSpecificationForThisFile = this.fileArchitecturalSpecificationEntry
                                .replace('{relativeFileName}', fileContent!.path)
                                .replace('{architecturalSpec}', ErrorGeneratingSpecification)

                        this.data.replace(unavailableSpecForThisFile, errorSpecificationForThisFile);

                        await this.updateProgress(`Failed to Build AI Spec for ${fileContent!.path} due to ${err}`);
                    }

                    // if there are no more files to process, we're done
                    if (filteredFileContents.length === 0) {
                        nextStage = ArchitecturalSpecificationStage.Complete;
                    } else {
                        nextStage = ArchitecturalSpecificationStage.FileSummarization;
                    
                    }
                }
            }
            break;
        }
        default:
            throw new Error(`Invalid Project Source Stage: ${stage}`);
        }
        await this.save();

        await this.updateProgress('Finished Stage ' + stage);

        return nextStage;
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
            throw new Error(`Unable to build blueprint from project samples: ${response.status}`);
        }

        const objectResponseRaw = await response.json();
        const responseData : SummarizerOutput = (objectResponseRaw.body?JSON.parse(objectResponseRaw.body):objectResponseRaw) as SummarizerOutput;

        return responseData.analysis;
    }
}