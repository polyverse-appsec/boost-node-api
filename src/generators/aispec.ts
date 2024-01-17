import { Generator } from './generator';
import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Stages } from '../types/GeneratorState';
import { FileContent } from '../github';

enum ArchitecturalSpecificationStage {
    ProjectInfo= 'Default',
    FileSummarization = 'Summarization of Files using AI',
    Complete = Stages.Complete,
}

export class ArchitecturalSpecificationGenerator extends Generator {
    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData) {
        super(serviceEndpoint, email, projectData, ProjectDataType.ProjectSource);
    }

readonly defaultArchitecturalSpecification =
`# Summary for {projectName}:\n\n\n`

readonly fileArchitecturalSpecificationEntry =
`# Summary for {relativeFileName}:\n{fileSource}\n\n`

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

            for (const fileContent of fileContents) {
                if (boostIgnore.ignores(fileContent.path)) {
                    continue;
                }

                this.data += this.fileArchitecturalSpecificationEntry
                        .replace('{relativeFileName}', fileContent.path)
                        .replace('{fileSource}', fileContent.source);
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
}