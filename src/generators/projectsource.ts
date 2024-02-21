import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Stages } from '../types/GeneratorState';
import { FileContent } from '../github';
import { Generator } from './generator';
const ignore = require('ignore');

enum ProjectSourceStage {
    FilePathScan = 'File Paths Scan',
    FullSourceScan = 'Full Source Code Import',
}

export class ProjectSourceGenerator extends Generator {
    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData) {
        super(serviceEndpoint, email, projectData, ProjectDataType.ProjectSource);
    }

readonly defaultProjectSource =
`# Contents of {projectName}:\n{projectRepo}\n\n`

readonly fileSourceEntry =
`# Contents of {relativeFileName}:\n{fileSource}\n\n`

    get validStages() : string[] {
        return Object.values(ProjectSourceStage);
    }

    async onGenerate(stage: string) : Promise<string> {

        let nextStage : string = "";
        switch (stage) {
        case Stages.StaticDefault:
            await this.updateProgress('Generating Initial Project Info');
            const projectRepos : string = this.projectData.resources.map((resource) => resource.uri).join('\n\n');
            this.data = this.defaultProjectSource
                .replace('{projectName}', this.projectData.name)
                .replace('{projectRepo}', projectRepos);

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
                const boostIgnore = ignore().add(boostIgnoreFileSpecs);

                await this.updateProgress('Filtering File Paths for .boostignore');

                let totalSizeImported = 0;
                let totalSizeSaved = 0;
                for (const fileContent of fileContents) {
                    totalSizeImported += fileContent.source.length;
                    if (boostIgnore.ignores(fileContent.path)) {
                        continue;
                    }
                    totalSizeSaved += fileContent.source.length;

                    this.data += this.fileSourceEntry
                            .replace('{relativeFileName}', fileContent.path)
                            .replace('{fileSource}', fileContent.source)
                }
                console.log(`Total size to save: ${totalSizeSaved} bytes of ${totalSizeImported} bytes Imported`);

                nextStage = Stages.Complete;
                break;
            }
        }

        return nextStage;
    }
}