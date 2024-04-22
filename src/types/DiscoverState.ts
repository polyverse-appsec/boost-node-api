import { DiscoveryTrigger } from "./DiscoveryTrigger";

export interface DiscoverState {
    resetResources?: boolean;
    requestor?: DiscoveryTrigger;
    version?: string;
    lastUpdated?: number;
}