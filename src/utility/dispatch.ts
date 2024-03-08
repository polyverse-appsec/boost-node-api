import axios from 'axios';

import { Request, Response } from 'express';
import { header_X_Signed_Identity, signedAuthHeader } from '../auth';
import { usFormatter } from './log';

export const api_root_endpoint : string = '/api';

export const secondsBeforeRestRequestMaximumTimeout = 25;

export const secondsBeforeRestRequestShortTimeout = 10;

export const HTTP_SUCCESS = 200;
export const HTTP_SUCCESS_ACCEPTED = 202;
export const HTTP_SUCCESS_NO_CONTENT = 204;

export const HTTP_FAILURE_BAD_REQUEST_INPUT = 400;
export const HTTP_FAILURE_UNAUTHORIZED = 401;
export const HTTP_FAILURE_NO_ACCESS = 403;
export const HTTP_FAILURE_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_LOCKED = 423;
export const HTTP_FAILURE_BUSY = 429;

export const HTTP_FAILURE_INTERNAL_SERVER_ERROR = 500;

export const logRequest = (req: Request, user: string) => {
    const logLine = `Request: ${user?user:"UNKNOWN"} ${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const currentDate = usFormatter.format(new Date(Date.now()));
    console.log(process.env.IS_OFFLINE?`${currentDate}: ${logLine}`:logLine);
}

export const handleErrorResponse = (error: any, req: Request, res: Response, supplementalErrorMessage: string = '', status_code: number = HTTP_FAILURE_INTERNAL_SERVER_ERROR) : Response => {
    // Base error message with the request details
    const errorMessage = `${status_code === HTTP_FAILURE_INTERNAL_SERVER_ERROR ? 'UN' : ''}HANDLED_ERROR(Response): ${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const errorCodeText = status_code === HTTP_FAILURE_INTERNAL_SERVER_ERROR ? 'Internal Server Error':"";

    const currentDate = usFormatter.format(new Date(Date.now()));

    if (axios.isAxiosError(error) && error.response) {

        console.error(`${process.env.IS_OFFLINE?`${currentDate}: `:``}${supplementalErrorMessage?`${supplementalErrorMessage} - `:''}${errorMessage}`, error.response.data.body || error.response.data);

        return res
            .status(status_code)
            .send(`${errorCodeText}: ${supplementalErrorMessage?`${supplementalErrorMessage} - `:''}${errorMessage} - ${error.response.data.body || error.response.data}`);
    }

    // Check if we're in the development environment
    if (process.env.DEPLOYMENT_STAGE === 'dev' || process.env.DEPLOYMENT_STAGE === 'test' || process.env.DEPLOYMENT_STAGE === 'local'
        || process.env.DEPLOYMENT_STAGE === 'prod') {

        // In development, print the full error stack if available, or the error message otherwise
        console.error(`${process.env.IS_OFFLINE?`${currentDate}: `:``}${supplementalErrorMessage?`${supplementalErrorMessage} - `:''}${errorMessage}`, error.stack || error);

        // Respond with the detailed error message for debugging purposes
        return res
            .status(status_code)
            .send(`${errorCodeText}: ${supplementalErrorMessage?`${supplementalErrorMessage} - `:''}` + (error.stack || error));

    } else { // we'll use this for 'prod' and 'test' Stages in the future

        // In non-development environments, log the error message for privacy/security reasons
        console.error(`${process.env.IS_OFFLINE?`${currentDate}: `:``}${supplementalErrorMessage?`${supplementalErrorMessage} - `:''}${errorMessage} `, error.message || error);
        // Respond with a generic error message to avoid exposing sensitive error details
        return res
            .status(status_code)
            .send(`${errorCodeText}:${supplementalErrorMessage?`${supplementalErrorMessage} - `:''}` + (error.message || error));
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
            if (response.data.body) {
                return JSON.parse(response.data.body) as T;
            } else {
                return response.data as T;
            }
        } catch (error : any) {
            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                if (process.env.TRACE_LEVEL || throwOnTimeout) {
                    console.warn(`TIMECHECK: TIMEOUT: ${httpVerb} ${selfEndpoint} timed out after ${timeoutMs / 1000} seconds`);
                }
                
                // if caller is launching an async process, and doesn't care about response, don't throw on timeout
                if (!throwOnTimeout) {
                    return {} as T;
                }
            } else {
                if (process.env.TRACE_LEVEL) {
                    // This block is for handling errors, including HTTP_FAILURE_NOT_FOUND and HTTP_FAILURE_INTERNAL_SERVER_ERROR status codes
                    if (axios.isAxiosError(error) && error.response) {
                        const errorMessage = error.response.data.body || error.response.data;
                        console.error(`${httpVerb} ${selfEndpoint} failed with status ${error.response.status}:${error.response.statusText} due to error: ${errorMessage}`);
                    } else {
                        // Handle other errors (e.g., network errors)
                        console.error(`${httpVerb} ${selfEndpoint} failed ${error.stack || error}`);
                    }
                }
                if (axios.isAxiosError(error) && error.response) {
                    throw new axios.AxiosError(error.response.data, error.code, undefined, undefined, error.response);
                }
            }
            throw error;
        }
    }
}