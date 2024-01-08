import { Generator } from './generator';
import { ProjectDataType } from '../types/ProjectData';
import { UserProjectData } from '../types/UserProjectData';
import { Stages } from '../types/GeneratorState';

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

        if (!stage || stage === Stages.Complete) {
            await this.updateProgress('Generating Default Blueprint');

            this.data = this.defaultBlueprint.replace('{projectName}', this.projectData.name);
            
            await this.save();
        }

        return Stages.Complete;
    }


}