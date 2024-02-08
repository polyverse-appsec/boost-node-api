export enum TaskStatus {
    Processing = 'processing',
    Idle = 'idle',
    Error = 'error',

}

export enum Stages {
    Initialize = 'Initialize',
    Complete = 'Complete',
}

export interface GeneratorState {
    stage?: string;
    last_updated?: number;
    status: TaskStatus;
    status_details?: string;
}