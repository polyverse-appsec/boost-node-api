import { ProjectStatus } from './ProjectStatus';
import { ProjectAssistantInfo } from './ProjectAssistantInfo';
import { DiscoveryTrigger } from './DiscoveryTrigger';
import { ResourceSourceState } from './ResourceSourceState';

export interface ProjectStatusState {
    status: ProjectStatus;
    synchronized?: boolean;
    lastSynchronized?: number;
    activelyUpdating?: boolean;
    resourcesState?: any[];
    possibleStagesRemaining?: number;
    processedStages?: number;
    childResources?: number;
    details?: string;
    lastUpdated: number;
    assistant?: ProjectAssistantInfo;
    lastDiscoveryTrigger?: DiscoveryTrigger;
    lastDiscoveryLaunch?: number;
    version?: string;
    sourceDataStatus?: ResourceSourceState[];
}