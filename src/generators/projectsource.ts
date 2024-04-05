import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Stages, GeneratorState } from '../types/GeneratorState';
import { ResourceSourceState } from '../types/ResourceSourceState';
import { FileContent, RepoDetails } from '../github';
import { Generator } from './generator';
const ignore = require('ignore');

enum ProjectSourceStage {
    SourceSyncPoints = 'Retrieve Source Sync Points',
    FilePathScan = 'File Paths Scan',
    FullSourceScan = 'Full Source Code Import',
}

export class ProjectSourceGenerator extends Generator {
    constructor(serviceEndpoint: string, email: string, projectData: UserProjectData) {
        super(serviceEndpoint, email, projectData, ProjectDataType.ProjectSource);
    }

    readonly projectsourceId = `"Project Source Code"`;

    readonly defaultProjectSource =
        `# ${this.projectsourceId} Contents of {projectName}:\n{projectRepo}\n\n` +
        `## Project Repositories:\n{projectRepo}\n\n\n`;

    readonly fileSourceEntry =
        `# Contents of {relativeFileName}:\n{fileSource}\n\n`

    get validStages() : string[] {
        return Object.values(ProjectSourceStage);
    }

    async onGenerate(stage: string) : Promise<string> {

        let nextStage : string = "";
        switch (stage) {
        case Stages.StaticDefault:
            await this.updateProgress('Generating Initial Project Info',
                { possibleStagesRemaining: 2, childResources: 0 } as GeneratorState);

            const projectRepos : string = this.projectData.resources.map((resource) => resource.uri).join('\n\n');

            this.data = this.defaultProjectSource
                .replace('{projectName}', this.projectData.name)
                .replace('{projectRepo}', projectRepos);

            nextStage = ProjectSourceStage.SourceSyncPoints;

            break;

        case ProjectSourceStage.SourceSyncPoints:
            {
                await this.updateProgress('Retrieving Project Source Sync Point');

                const syncPoints : RepoDetails[] = await this.getProjectSourceSyncPoints();
                if (syncPoints?.length) {
                    const syncPointsData = syncPoints.map((syncPoint) => {
                        if (syncPoint.lastCommitDateTime && syncPoint.lastCommitHash) {
                            const syncTimeAsUnixTime = new Date(syncPoint.lastCommitDateTime).getTime() / 1000;
                            return {
                                syncTime: syncTimeAsUnixTime,
                                syncHash: syncPoint.lastCommitHash,
                            } as ResourceSourceState;
                        }
                        return {};
                    });
                    await this.updateProgress(`Found ${syncPoints.length} Project Source Sync Points`, 
                        { resourceStatus: syncPointsData } as GeneratorState);
                } else {
                    await this.updateProgress('No Project Source Sync Points Found');
                }

                nextStage = ProjectSourceStage.FilePathScan;
            }

        case ProjectSourceStage.FilePathScan:
            {
                const filteredFilepathList : string[] = await this.getFilteredFileList();

                await this.updateProgress(`Importing File Paths for ${filteredFilepathList.length} files`,
                    { possibleStagesRemaining: filteredFilepathList.length, childResources: filteredFilepathList.length } as GeneratorState);

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

                await this.updateProgress('Filtering Project Source Content based on .boostignore');

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