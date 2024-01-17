import { Generator, GeneratorProcessingError } from './generator';
import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Stages } from '../types/GeneratorState';
import { FileContent } from '../github';
import { AIResponse } from '../boost-python-api/AIResponse';
import { Services } from '../boost-python-api/endpoints';
import { signedAuthHeader } from '../auth';

enum ArchitecturalSpecificationStage {
    ProjectInfo= 'Default',
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

        let nextStage;
        switch (stage) {
        case ArchitecturalSpecificationStage.Complete:
        case ArchitecturalSpecificationStage.ProjectInfo:
            await this.updateProgress('Generating Initial Project Info');
            this.data = this.defaultArchitecturalSpecification
                .replace('{projectName}', this.projectData.name)
                .replace('{projectRepo}', this.projectData.resources[0].uri);

            nextStage = ArchitecturalSpecificationStage.FileSummarization;

            break;

        case ArchitecturalSpecificationStage.FileSummarization:
            await this.updateProgress('Importing Full Project Source');

            // now we'll go back and update the file contents
            const fileContents : FileContent[] = await this.getProjectSource();


            // we're going to start empty file contents to be fast, then we'll
            //      update the contents later
            const boostIgnoreFileSpecs = await this.getBoostIgnoreFileSpecs();
            const boostIgnore = require('ignore')().add(boostIgnoreFileSpecs);

            await this.updateProgress('Filtering File Paths for .boostignore');

            // track the # of spec creation errors... if too high, we'll abort and retry
            let numberOfErrors : number = 0;
            let totalSpecs : number = 0;

            for (const fileContent of fileContents) {
                if (boostIgnore.ignores(fileContent.path)) {
                    continue;
                }

                totalSpecs++;

                try {
                    const architecturalSpec : string = await this.createArchitecturalSpecification(fileContent.source);

                    this.data += this.fileArchitecturalSpecificationEntry
                            .replace('{relativeFileName}', fileContent.path)
                            .replace('{architecturalSpec}', architecturalSpec);
                } catch (err) {
                    console.log(`Error creating architectural specification for ${fileContent.path}: ${err}`);
                    numberOfErrors++;

                    this.data += this.fileArchitecturalSpecificationEntry
                            .replace('{relativeFileName}', fileContent.path)
                            .replace('{architecturalSpec}', 'No Specification avaialable');
                }
            }

            // if we have higher than 25% errors, we'll abort and retry
            //    we throw here - which marks the generator in error state with reason, and enables
            //    caller or groomer to restart this stage
            // For very small projects (less than 10 files), we'll be less tolerant of errors
            //    since a couple errors can dramatically skew the results
            if (totalSpecs > 10) {
                if (numberOfErrors > (totalSpecs / 4)) {
                    throw new GeneratorProcessingError(
                        `Too many errors creating architectural specifications: ${numberOfErrors} errors out of ${totalSpecs} files`,
                        ArchitecturalSpecificationStage.FileSummarization);
                }
            } else if (numberOfErrors > 2) {
                throw new GeneratorProcessingError(
                    `Too many errors creating architectural specifications: ${numberOfErrors} errors out of ${totalSpecs} files`,
                    ArchitecturalSpecificationStage.FileSummarization);
            }

            nextStage = ArchitecturalSpecificationStage.Complete;

            break;
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
        const responseData : SummarizerOutput = await response.json();
        return responseData.analysis;
    }
}