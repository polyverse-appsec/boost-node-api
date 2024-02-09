import { Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { getSingleSecret } from './secrets';
import { getUser } from './users';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { App } from "octokit";
import { handleErrorResponse } from './utility/dispatch';


const BoostGitHubAppId = "472802";

export async function getFileFromRepo(email: string, fullFileUri: URL, repoUri: URL, pathUri: string, req: Request, res: Response, allowPrivateAccess: boolean): Promise<any> {
    let owner: string;
    let repo: string;
    let pathParts: string[];

    if (fullFileUri) {
        // Extract owner, repo, and path from fullFileUri
        [, owner, repo, ...pathParts] = fullFileUri.pathname.split('/');
    } else {
        // Extract owner and repo from repoUri
        // Assume repoUri is like "https://github.com/owner/repo"
        [, owner, repo] = repoUri.pathname.split('/');
        // Use pathUri as the path
        pathParts = pathUri.split('/');
    }

    // Check if owner, repo, and pathParts are valid
    if (!owner || !repo || pathParts.length === 0) {
        console.error(`Error: Invalid GitHub.com resource URI: ${fullFileUri || repoUri}`);
        return res.status(400).send('Invalid URI');
    }

    // Convert pathParts array back to a string path if necessary
    const filePath = pathParts.join('/');
    const filePathWithoutBranch = filePath.replace(/^blob\/(main|master)\//, '');

    // Inline function to get file content
    const getFileContent = async (octokit : Octokit) => {
        const response = await octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: filePathWithoutBranch
        });

        if ("content" in response.data && typeof response.data.content === 'string') {
            return Buffer.from(response.data.content, 'base64').toString('utf8');
        } else {
            throw new Error('Content not found or not a file');
        }
    };

    // try to get the file from GitHub via public path without authentication
    try {
        const octokit = new Octokit();
        const fileContent = await getFileContent(octokit);

        console.log(`Success Retrieving File ${filePathWithoutBranch} from Public Repo ${repo}`)

        return res
            .status(200)
            .set('X-Resource-Access', 'public')
            .contentType('text/plain')
            .send(fileContent);

    } catch (publicError : any) {
        if (publicError.status !== 404 && publicError?.response?.data?.message !== 'Not Found') {
            if (publicError.status === 403 && publicError.response.headers['x-ratelimit-remaining'] === '0') {
                // Handle rate limit exceeded error
                const resetTime = publicError.response.headers['x-ratelimit-reset'];

                // if private access is allowed, then we'll try that - log a warning instead of an error and skip other error handling
                if (allowPrivateAccess) {
                    console.warn(`Warning: Rate limit exceeded for Public Access to ${repo} File ${filePathWithoutBranch}. Trying Private Access with ${email}`);
                } else {
                    console.error(`Rate limit exceeded for Public Access to ${repo} File ${filePathWithoutBranch}. Reset time: ${new Date(resetTime * 1000)}`);
                    // return a rate limit response
                    return res.status(429).send('Rate Limit Exceeded');
                }
            } else {
                return handleErrorResponse(publicError, req, res, `Error retrieving public access file for ${owner}:${repo} at path ${filePathWithoutBranch}`);
            }
        } else {
            // 404 Not Found
            console.log(`Cannot access repo ${owner}/${repo} at path ${filePathWithoutBranch}`);
        }
    }

    if (!allowPrivateAccess) {
        console.error(`Error: Private Access Not Allowed for this Plan: ${filePath}`);
        return res.status(401).send('Access to Private GitHub Resources is not allowed for this Account');
    }

    // Process for private access
    try {
        // try by the repo org first, then by the user
        let user = await getUser(owner);
        if (!user) {
            user = await getUser(email);
            if (!user) {
                console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            }
        }
        const installationId = user?.installationId;
        if (!installationId) {
            console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            return res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
        }

        const secretStore = 'boost/GitHubApp';
        const secretKeyPrivateKey = secretStore + '/' + 'private-key';
        const privateKey = await getSingleSecret(secretKeyPrivateKey);

        const octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: BoostGitHubAppId,
                privateKey: privateKey,
                installationId: installationId,
            }
        });

        const fileContent = await getFileContent(octokit);

        console.log(`Success Retrieving File ${filePathWithoutBranch} from Private Repo ${repo}`)

        return res
            .status(200)
            .set('X-Resource-Access', 'private')
            .contentType('text/plain')
            .send(fileContent);

    } catch (error) {
        return handleErrorResponse(error, req, res, `Error retrieving file via private access to ${owner}:${repo} at path ${filePathWithoutBranch}`);
    }
}

export async function getFolderPathsFromRepo(email: string, uri: URL, req: Request, res: Response, allowPrivateAccess: boolean) {
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }
    
    const getFolderPaths = async (octokit: Octokit, owner: string, repo : string, path = '') : Promise<string[]> => {
        let folderPaths : string[] = [];
    
        const response = await octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: path
        });

        if (!Array.isArray(response.data)) {
            throw new Error('Expected directory content, got something else');
        }

        for (const item of response.data.filter(item => !item.name.startsWith('.'))) {
            if (item.type === 'dir') {
                folderPaths.push(item.path);

                // Recursively get paths of subdirectories
                const subfolderPaths = await getFolderPaths(octokit, owner, repo, item.path);
                folderPaths = folderPaths.concat(subfolderPaths);
            }
        }

        return folderPaths;
    };
    

    // Try to get the folders from GitHub via public path without authentication
    try {
        const octokit = new Octokit();
        const folderPaths = await getFolderPaths(octokit, owner, repo);

        return res
            .status(200)
            .contentType('application/json')
            .send(folderPaths);
    } catch (publicError: any) {
        if (publicError.status !== 404 && publicError?.response?.data?.message !== 'Not Found') {
            if (publicError.status === 403 && publicError.response.headers['x-ratelimit-remaining'] === '0') {
                // Handle rate limit exceeded error
                const resetTime = publicError.response.headers['x-ratelimit-reset'];

                // if private access is allowed, then we'll try that - log a warning instead of an error and skip other error handling
                if (allowPrivateAccess) {
                    console.warn(`Warning: Rate limit exceeded for Public Access to ${owner} repo ${repo} folder paths. Trying Private Access with ${email}`);
                } else {
                    console.error(`Rate limit exceeded for Public Access to ${owner} repo ${repo} folder paths. Reset time: ${new Date(resetTime * 1000)}`);
                    // return a rate limit response
                    return res.status(429).send('Rate Limit Exceeded');
                }
            } else {
                return handleErrorResponse(publicError, req, res, `Error retrieving folder paths for ${owner} to ${repo}`);
            }
        } else {
            console.log(`Unable to publicly retrieve folder paths for ${owner} from ${repo}:`, publicError);
        }
    }

    if (!allowPrivateAccess) {
        console.error(`Error: Private Access Not Allowed for this Plan: ${repo}`);
        return res.status(401).send('Access to Private GitHub Resources is not allowed for this Account');
    }

    // Private access part
    try {
        // try by the repo org first, then by the user
        let user = await getUser(owner);
        if (!user) {
            user = await getUser(email);
            if (!user) {
                console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            }
        }
        const installationId = user?.installationId;
        if (!installationId) {
            console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            return res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
        }

        const secretStore = 'boost/GitHubApp';
        const secretKeyPrivateKey = secretStore + '/' + 'private-key';
        const privateKey = await getSingleSecret(secretKeyPrivateKey);

        // Configure the auth strategy for Octokit
        const octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: BoostGitHubAppId,
                privateKey: privateKey,
                installationId: installationId,
            }
        });

        const folderPaths = await getFolderPaths(octokit, owner, repo);

        console.log(`Success Retrieving ${folderPaths.length} folder paths from Private Repo ${repo}`)

        return res
            .set('X-Resource-Access', 'private')
            .status(200)
            .contentType('application/json')
            .send(folderPaths);

    } catch (error) {
        return handleErrorResponse(error, req, res, `Error retrieving folders for ${owner} to ${repo} via private access`);
    }
}

export async function getFilePathsFromRepo(email: string, uri: URL, req: Request, res: Response, allowPrivateAccess: boolean) {
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const getFilePaths = async (octokit : Octokit, owner : string, repo : string, path = '') : Promise<string[]> => {
        let filePaths : string[] = [];

        const response = await octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: path
        });

        if (!Array.isArray(response.data)) {
            throw new Error('Expected file content, got something else');
        }

        for (const item of response.data) {
            if (item.type === 'file') {
                filePaths.push(item.path);
            } else if (item.type === 'dir') {
                // Recursive call for directories
                const subPaths = await getFilePaths(octokit, owner, repo, item.path);
                filePaths = filePaths.concat(subPaths);
            }
        }

        return filePaths;
    };

    // Try to get the files from GitHub via public path without authentication
    try {
        const octokit = new Octokit();
        const filePaths = await getFilePaths(octokit, owner, repo);

        console.log(`Success Retrieving ${filePaths.length} file paths from Public Repo ${repo}`)

        return res
            .status(200)
            .contentType('application/json')
            .send(filePaths);
    } catch (publicError : any) {
        if (publicError.status !== 404 && publicError?.response?.data?.message !== 'Not Found') {
            if (publicError.status === 403 && publicError.response.headers['x-ratelimit-remaining'] === '0') {
                // Handle rate limit exceeded error
                const resetTime = publicError.response.headers['x-ratelimit-reset'];
                if (allowPrivateAccess) {
                    console.warn(`Warning: Rate limit exceeded for Public Access to ${owner} repo ${repo} file paths. Trying Private Access with ${email}`);
                } else {
                    console.error(`Rate limit exceeded for Public Access to ${owner} repo ${repo} file paths. Reset time: ${new Date(resetTime * 1000)}`);
                    // return a rate limit response
                    return res.status(429).send('Rate Limit Exceeded');
                }
            } else {
                return handleErrorResponse(publicError, req, res, `Error retrieving file paths for ${owner} to ${repo}`);
            }
        } else {
            console.log(`Unable to publicly retrieve file paths for ${owner} from ${repo}:`, publicError);
        }
    }

    if (!allowPrivateAccess) {
        console.error(`Error: Private Access Not Allowed for this Plan: ${repo}`);
        return res.status(401).send('Access to Private GitHub Resources is not allowed for this Account');
    }

    // Private access part
    try {
        // try by the repo org first, then by the user
        let user = await getUser(owner);
        if (!user) {
            user = await getUser(email);
            if (!user) {
                console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            }
        }
        const installationId = user?.installationId;
        if (!installationId) {
            console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            return res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
        }

        const secretStore = 'boost/GitHubApp';
        const secretKeyPrivateKey = secretStore + '/' + 'private-key';
        const privateKey = await getSingleSecret(secretKeyPrivateKey);

        // Configure the auth strategy for Octokit
        const octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: BoostGitHubAppId,
                privateKey: privateKey,
                installationId: installationId,
            }
        });

        const filePaths : string[] = await getFilePaths(octokit, owner, repo);

        console.log(`Success Retrieving ${filePaths.length} file paths from Private Repo ${repo}`)

        return res
            .set('X-Resource-Access', 'private')
            .status(200)
            .contentType('application/json')
            .send(filePaths);

    } catch (error) {
        return handleErrorResponse(error, req, res, `Error retrieving files for ${owner} to ${repo} via private access`);
    }
}

export interface FileContent {
    path: string;
    source: string;
}

export interface RepoDetails {
    data?: any;
    errorResponse?: any;
}

// returns details of repo, or undefined if res/Response is an error written
export async function getDetailsFromRepo(email: string, uri: URL, req: Request, res: Response, allowPrivateAccess: boolean) : Promise<RepoDetails>{
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return { errorResponse: res.status(400).send('Invalid URI') };
    }

    const octokit = new Octokit();
    try {
        // Fetch repository details to get the default branch
        const repoDetails = await octokit.rest.repos.get({
            owner: owner,
            repo: repo
        });

        return { data: repoDetails.data };

    } catch (publicError: any) {
        if (publicError.status !== 404 && publicError?.response?.data?.message !== 'Not Found') {
            if (publicError.status === 403 && publicError.response.headers['x-ratelimit-remaining'] === '0') {
                // Handle rate limit exceeded error
                const resetTime = publicError.response.headers['x-ratelimit-reset'];
                if (allowPrivateAccess) {
                    console.warn(`Warning: Rate limit exceeded for Public Access to ${owner} repo ${repo} details. Trying Private Access with ${email}`);
                } else {
                    console.error(`Rate limit exceeded for Public Access to ${owner} repo ${repo} details. Reset time: ${new Date(resetTime * 1000)}`);
                    // return a rate limit response
                    return { errorResponse: res.status(429).send('Rate Limit Exceeded') };
                }
            } else {
                return { errorResponse: handleErrorResponse(
                    publicError, req, res, `Error retrieving repo details for ${owner} to ${repo}`)};
            }
        } else {
            console.log(`Public access for ${owner} to ${repo} to get Repo Details, attempting authenticated access`);
        }

        if (!allowPrivateAccess) {
            console.error(`Error: Private Access Not Allowed for this Plan: ${repo}`);
            return { errorResponse: res.status(401).send('Access to Private GitHub Resources is not allowed for this Account') };
        }
    
        // Public access failed, switch to authenticated access
        try {
            // try by the repo org first, then by the user
            let user = await getUser(owner);
            if (!user) {
                user = await getUser(email);
                if (!user) {
                    console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                    return { errorResponse: res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`) };
                }
            }
            const installationId = user?.installationId;
            if (!installationId) {
                console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return { errorResponse: res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`) };
            }

            const secretStore = 'boost/GitHubApp';
            const secretKeyPrivateKey = secretStore + '/' + 'private-key';
            const privateKey = await getSingleSecret(secretKeyPrivateKey);

            const app = new App({
                appId: BoostGitHubAppId,
                privateKey: privateKey,
            });
            const octokit = await app.getInstallationOctokit(Number(installationId));            

            // const reposForOrg = await octokit.rest.repos.listForOrg({type: "private", org: "polyverse-appsec"});
            const repoDetails = await octokit.rest.repos.get({
                owner: owner,
                repo: repo
            });

            console.log(`Success Retrieving Repo Details from Private Repo ${repo}`)

            return { data: repoDetails.data };
        } catch (authenticatedError) {
            return { errorResponse: handleErrorResponse(
                authenticatedError, req, res, 'Error retrieving repo details via authenticated access')};
        }
    }
}

export async function verifyUserAccessToPrivateRepo(email: string, uri: URL, req: Request, res: Response) : Promise<boolean>{
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        throw new Error(`Invalid GitHub.com resource URI: ${uri}`);
    }

    const user = await getUser(email);
    if (!user) {
        throw new Error(`GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
    } else if (!user?.username) {
        throw new Error(`Invalid GitHub App Installation - cannot find GitHub Username for ${email}`);
    }

    const installationId = (await getUser(owner))?.installationId;
    if (!installationId) {
        throw new Error(`GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${owner}`);
    }

    const secretStore = 'boost/GitHubApp';
    const secretKeyPrivateKey = secretStore + '/' + 'private-key';
    const privateKey = await getSingleSecret(secretKeyPrivateKey);

    const app = new App({
        appId: BoostGitHubAppId,
        privateKey: privateKey,
    });
    const octokit = await app.getInstallationOctokit(Number(installationId));            

    const collaboratorCheckInput = {
        owner,
        repo,
        username: user.username
    };
    const response = await octokit.rest.repos.getCollaboratorPermissionLevel(collaboratorCheckInput);
    // check if the username has access to this repo
    if (response.status !== 200 || !response.data.permission) {
        console.warn(`User ${user.username} does not have access to ${owner}:${repo}`);
        return false;
    }

    console.debug(`User ${user.username} has access to ${owner}:${repo}`);

    return true;
}

export async function getFullSourceFromRepo(email: string, uri: URL, req: Request, res: Response, allowPrivateAccess: boolean) {
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const downloadAndExtractRepo = async (url: string, authToken: string): Promise<FileContent[]> => {
        const params: any = authToken ? {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                responseType: 'arraybuffer'
            } : {
                responseType: 'arraybuffer'
            };
        const response = await axios.get(url, params);
        const zip = new AdmZip(response.data);
        const zipEntries = zip.getEntries();
    
        const skippedFiles : string[] = [];
    
        // Assuming the first entry is the root folder and get its name
        const rootFolderName = zipEntries[0].entryName;
    
        // Skip the first entry and filter out directories and binary files
        const filteredEntries = zipEntries.slice(1).filter(entry => {
            if (entry.isDirectory) {
                return false;  // Skip directories (folders)
            }

            if (isBinary(entry.getData())) {
                skippedFiles.push(entry.entryName.replace(rootFolderName, ''));
                return false;  // Skip this entry
            }

            return true;  // Include this entry
        }).map(entry => {
            const relativePath = entry.entryName.replace(rootFolderName, '');
            const source = entry.getData().toString('utf8');  // Convert to UTF-8 string
            return { path: relativePath, source: source };
        });
    
        if (process.env.TRACE_LEVEL) {
            console.log(`Skipped ${skippedFiles.length} probable binary files: ${skippedFiles.join(', ')}`);
        } else {
            console.log(`Skipped ${skippedFiles.length} probable binary files`);
        }
    
        return filteredEntries;  // Return the filtered entries
    };
    
    // Function to check if a buffer contains binary data
    function isBinary(buffer: Buffer): boolean {
        return buffer.includes(0x00);  // Checks for null byte
    }    
    
    const octokit = new Octokit();
    try {
        // Fetch repository details to get the default branch
        const repoDetails = await octokit.rest.repos.get({
            owner: owner,
            repo: repo
        });
        const defaultBranch = repoDetails.data.default_branch;

        // Attempt to retrieve the repository source publicly
        const publicArchiveUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${defaultBranch}`;

        const fileContents : FileContent[]= await downloadAndExtractRepo(publicArchiveUrl, '');

        console.log(`Success Retrieving ${fileContents.length} files (${(JSON.stringify(fileContents).length / (1024 * 1024)).toFixed(2)} MB) from Public Repo ${owner}:${repo}`)

        return res
            .status(200)
            .contentType('application/json')
            .send(fileContents);

    } catch (publicError: any) {
        if (publicError.status !== 404 && publicError?.response?.data?.message !== 'Not Found') {
            if (publicError.status === 403 && publicError.response.headers['x-ratelimit-remaining'] === '0') {
                // Handle rate limit exceeded error
                const resetTime = publicError.response.headers['x-ratelimit-reset'];
                if (allowPrivateAccess) {
                    console.warn(`Warning: Rate limit exceeded for Public Access to ${owner} repo ${repo} full source. Trying Private Access with ${email}`);
                } else {
                    console.error(`Rate limit exceeded for Public Access to ${owner} repo ${repo} full source. Reset time: ${new Date(resetTime * 1000)}`);
                    // return a rate limit response
                    return res.status(429).send('Rate Limit Exceeded');
                }
            } else {
                return handleErrorResponse(publicError, req, res, `Error retrieving full source for ${owner} from ${repo}`);
            }
        } else {
            console.log(`Public access for ${repo} to get Full Source failed, attempting authenticated access`);
        }

        if (!allowPrivateAccess) {
            console.error(`Error: Private Access Not Allowed for this Plan: ${repo}`);
            return res.status(401).send('Access to Private GitHub Resources is not allowed for this Account');
        }
    
        // Public access failed, switch to authenticated access
        try {
            // try by the repo org first, then by the user
            let user = await getUser(owner);
            if (!user) {
                user = await getUser(email);
                if (!user) {
                    console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                    return res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                }
            }
            const installationId = user?.installationId;
            if (!installationId) {
                console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            }

            const secretStore = 'boost/GitHubApp';
            const secretKeyPrivateKey = secretStore + '/' + 'private-key';
            const privateKey = await getSingleSecret(secretKeyPrivateKey);

            const app = new App({
                appId: BoostGitHubAppId,
                privateKey: privateKey,
            });
            const octokit = await app.getInstallationOctokit(Number(installationId));
            // Fetch repository details to get the default branch
            const repoDetails = await octokit.rest.repos.get({
                owner: owner,
                repo: repo
            });
            const defaultBranch = repoDetails.data.default_branch;
            
            const archiveUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${defaultBranch}`;

                    // Generate the installation access token
            const installationAccessToken : any = await octokit.auth({ type: "installation" });
            
            // Ensure we have the token
            if (!installationAccessToken?.token) {
                const getInstallationAccessTokenError = new Error('Failed to retrieve installation access token');
                return handleErrorResponse(getInstallationAccessTokenError, req, res);
            }

            let fileContents : FileContent[] = await downloadAndExtractRepo(archiveUrl, installationAccessToken.token);

            console.log(`Success Retrieving ${fileContents.length} files (${(JSON.stringify(fileContents).length / (1024 * 1024)).toFixed(2)} MB) from Private Repo ${owner}:${repo}`)

            return res
                .status(200)
                .contentType('application/json')
                .send(fileContents);
        } catch (authenticatedError) {
            return handleErrorResponse(authenticatedError, req, res, 'Error retrieving full source via authenticated access');
        }
    }
}
