import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Stages } from '../types/GeneratorState';
import { FileContent } from '../github';
import { Generator } from './generator';

enum ProjectSourceStage {
    ProjectInfo= 'Default',
    FilePathScan = 'File Paths Scan',
    FullSourceScan = 'Full Source Code Import',
    Complete = Stages.Complete,

}

export class ProjectSourceGenerator extends Generator {
    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData) {
        super(serviceEndpoint, email, projectData, ProjectDataType.ProjectSource);
    }

readonly defaultProjectSource =
`# Contents of {projectName}:\n{projectRepo}\n\n`

readonly fileSourceEntry =
`# Contents of {relativeFileName}:\n{fileSource}\n\n`

    async generate(stage?: string) : Promise<string> {

        if (!stage) {
            stage = ProjectSourceStage.Complete;
        }

        let nextStage;
        switch (stage) {
        case ProjectSourceStage.Complete:
        case ProjectSourceStage.ProjectInfo:
            await this.updateProgress('Generating Initial Project Info');
            this.data = this.defaultProjectSource
                .replace('{projectName}', this.projectData.name)
                .replace('{projectRepo}', this.projectData.resources[0].uri);

            nextStage = ProjectSourceStage.FilePathScan;

            break;

        case ProjectSourceStage.FilePathScan:
            {
                const filteredFilepathList : string[] = await this.getFilteredFileList();

                await this.updateProgress('Importing File Paths');

                // build the combined file entries from all the file paths
                for (const filepath of filteredFilepathList) {

                    // we're going to start empty file contents to be fast, then we'll
                    //      update the contents later
                    this.data += this.fileSourceEntry
                        .replace('{relativeFileName}', filepath)
                        .replace('{fileSource}', '');
                }

                nextStage = ProjectSourceStage.FullSourceScan;
            }
            break;
        case ProjectSourceStage.FullSourceScan:
            {
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

                    this.data += this.fileSourceEntry
                            .replace('{relativeFileName}', fileContent.path)
                            .replace('{fileSource}', fileContent.source)
                }

                nextStage = ProjectSourceStage.Complete;
            }
            break;
        default:
            throw new Error(`Invalid Project Source Stage: ${stage}`);
        }
        await this.save();

        await this.updateProgress('Finished Stage ' + stage);

        return nextStage;
    }
}