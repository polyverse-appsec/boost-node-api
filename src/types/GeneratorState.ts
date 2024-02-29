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

export interface GeneratorState {
    stage?: string;
    lastUpdated?: number;
    status: TaskStatus;
    status_details?: string;
    processedStages?: number;
}