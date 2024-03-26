export enum TaskStatus {
    Processing = 'processing',
    Idle = 'idle',
    Error = 'error',

}

export enum Stages {
    Reset = 'Reset',
    StaticDefault = 'Static Default',
    Complete = 'Complete',
}

export interface ResourceSourceState {
    syncTime?: number;
    syncHash?: string;
}

export interface GeneratorState {
    stage?: string;
    lastUpdated?: number;
    status: TaskStatus;
    statusDetails?: string;
    processedStages?: number;
    possibleStagesRemaining?: number;
    childResources?: number;
    resourceStatus?: ResourceSourceState[];
}