import axios from 'axios';
import { Request } from 'express';
import { header_X_Signed_Identity, signedAuthHeader } from '../auth';

export const api_root_endpoint : string = '/api';

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