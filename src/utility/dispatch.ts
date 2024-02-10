import axios from 'axios';
import { Request, Response } from 'express';
import { header_X_Signed_Identity, signedAuthHeader } from '../auth';

export const api_root_endpoint : string = '/api';

export const secondsBeforeRestRequestMaximumTimeout = 25;

export const secondsBeforeRestRequestShortTimeout = 10;

export const logRequest = (req: Request) => {
    if (process.env.DEPLOYMENT_STAGE === 'dev') {
        console.log(`Request: ${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl}`);
    }
}

export const handleErrorResponse = (error: any, req: Request, res: Response, supplementalErrorMessage: string = 'Error') : Response => {
    // Base error message with the request details
    const errorMessage = `UNHANDLED_ERROR(Response): ${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Check if we're in the development environment
    if (process.env.DEPLOYMENT_STAGE === 'dev' || process.env.DEPLOYMENT_STAGE === 'test' || process.env.DEPLOYMENT_STAGE === 'local'
        || process.env.DEPLOYMENT_STAGE === 'prod') {
        // In development, print the full error stack if available, or the error message otherwise
        console.error(`${supplementalErrorMessage} - ${errorMessage}`, error.stack || error);
        // Respond with the detailed error message for debugging purposes
        return res
            .status(500)
            .send(`Internal Server Error: ${supplementalErrorMessage} - ` + (error.stack || error));
    } else { // we'll use this for 'prod' and 'test' Stages in the future
        // In non-development environments, log the error message for privacy/security reasons
        console.error(`${supplementalErrorMessage} - ${errorMessage}`, error.message || error);
        // Respond with a generic error message to avoid exposing sensitive error details
        return res
            .status(500)
            .send(`Internal Server Error: ${supplementalErrorMessage} - ${errorMessage}` + (error.message || error));
    }
}

export async function localSelfDispatch<T>(
    email: string, originalIdentityHeader: string, initialRequestOrSelfEndpoint: Request | string,
    path: string, httpVerb: string, bodyContent?: any, timeoutMs: number = 0, throwOnTimeout: boolean = true): Promise<T> {

    if (!originalIdentityHeader) {
        const identityHeader = await signedAuthHeader(email);
        originalIdentityHeader = identityHeader[header_X_Signed_Identity];
    }

    let selfEndpoint : string;
    if (typeof initialRequestOrSelfEndpoint === 'string') {
        selfEndpoint = `${initialRequestOrSelfEndpoint as string}${api_root_endpoint}/${path}`;
    } else {
        selfEndpoint =`${initialRequestOrSelfEndpoint.protocol}://${initialRequestOrSelfEndpoint.get('host')}${api_root_endpoint}/${path}`;
        // if we're running locally, then we'll use http:// no matter what
        if (initialRequestOrSelfEndpoint.get('host')!.includes('localhost')) {
            selfEndpoint = `http://${initialRequestOrSelfEndpoint.get('host')}${api_root_endpoint}/${path}`;
        }
    }

    if (!timeoutMs) {

        const fetchOptions : RequestInit = {
            method: httpVerb,
            headers: {
                'X-Signed-Identity': originalIdentityHeader,
            }
        };

        if (['POST', 'PUT'].includes(httpVerb) && bodyContent) {
            fetchOptions.body = JSON.stringify(bodyContent);
            fetchOptions.headers = {
                ...fetchOptions.headers,
                'Content-Type': 'application/json'
            };
        }

        let response;
        
        try {
            response = await fetch(selfEndpoint, fetchOptions);
        } catch (error) {
            console.error(`Request ${httpVerb} ${selfEndpoint} failed with error ${error}`);
            throw error;
        }

        if (response.ok) {
            if (['GET'].includes(httpVerb)) {
                const objectResponse = await response.json();
                return (objectResponse.body?JSON.parse(objectResponse.body):objectResponse) as T;
            } else if (['POST', 'PUT', 'PATCH'].includes(httpVerb) && response.status === 200) {
                let objectResponse;
                try {
                    objectResponse = await response.json();
                } catch (error) {
                    console.error(`Request ${httpVerb} ${selfEndpoint} failed with error ${error}`);
                    return {} as T;
                }
                return (objectResponse.body?JSON.parse(objectResponse.body):objectResponse) as T;
            } else { // DELETE
                return {} as T;
            }
        }

        throw new axios.AxiosError(
            `Request ${selfEndpoint} failed with status ${response.status}: ${response.statusText}`,
            response.status.toString());
    } else {
        const headers = {
            'X-Signed-Identity': originalIdentityHeader,
            'Content-Type': 'application/json'
        };
    
        const axiosConfig = {
            headers: headers,
            timeout: timeoutMs
        };
    
        try {
            let response;
            switch (httpVerb.toLowerCase()) {
                case 'get':
                    response = await axios.get(selfEndpoint, axiosConfig);
                    break;
                case 'post':
                    response = await axios.post(selfEndpoint, bodyContent, axiosConfig);
                    break;
                case 'put':
                    response = await axios.put(selfEndpoint, bodyContent, axiosConfig);
                    break;
                case 'delete':
                    response = await axios.delete(selfEndpoint, axiosConfig);
                    break;
                case 'patch':
                    response = await axios.patch(selfEndpoint, bodyContent, axiosConfig);
                    break;
                default:
                    throw new Error(`Invalid HTTP Verb: ${httpVerb}`);
            }
    
            // Axios automatically parses JSON, so no need to manually parse it here.
            return response.data as T;
        } catch (error : any) {
            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                console.log(`TIMECHECK: TIMEOUT: ${httpVerb} ${selfEndpoint} timed out after ${timeoutMs / 1000} seconds`);

                // if caller is launching an async process, and doesn't care about response, don't throw on timeout
                if (!throwOnTimeout) {
                    return {} as T;
                }
            } else {
                // This block is for handling errors, including 404 and 500 status codes
                if (axios.isAxiosError(error) && error.response) {
                    console.log(`TIMECHECK: ${httpVerb} ${selfEndpoint} failed with status ${error.response.status}:${error.response.statusText} due to error:${error}`);
                } else {
                    // Handle other errors (e.g., network errors)
                    console.log(`TIMECHECK: ${httpVerb} ${selfEndpoint} failed ${error}`);
                }
            }
            throw error;
        }
    }
}