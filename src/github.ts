import { Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { getSingleSecret } from './secrets';
import { getUser } from './users';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { App } from "octokit";


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
                console.error(`Rate limit exceeded for Public Access to ${repo} File ${filePathWithoutBranch}. Reset time: ${new Date(resetTime * 1000)}`);
            } else {
                console.error(`Error: retrieving file via public access`, publicError);
            }
            return res.status(500).send('Internal Server Error');
        }

        // 404 Not Found
        console.log(`Cannot access repo ${owner}/${repo} at path ${filePathWithoutBranch}`);
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
        console.error(`Error retrieving file via private access:`, error);
        return res.status(500).send('Internal Server Error');
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
                console.error(`Rate limit exceeded for Public Access to ${owner} repo ${repo} folder paths. Reset time: ${new Date(resetTime * 1000)}`);
            } else {
                console.error(`Error retrieving folder paths for ${owner} from ${repo}:`, publicError);
            }
            return res.status(500).send('Internal Server Error');
        }

        console.log(`Unable to publicly retrieve folder paths for ${owner} from ${repo}:`, publicError);
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
        console.error(`Error retrieving folders via private access:`, error);
        return res.status(500).send('Internal Server Error');
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
                console.error(`Rate limit exceeded for Public Access to ${owner} repo ${repo} file paths. Reset time: ${new Date(resetTime * 1000)}`);
            } else {
                console.error(`Error retrieving file paths for ${owner} from ${repo}:`, publicError);
            }
            return res.status(500).send('Internal Server Error');
        }

        console.log(`Unable to publicly retrieve file paths for ${owner} from ${repo}:`, publicError);
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
        console.error(`Error retrieving files for ${owner} to ${repo} via private access:`, error);
        return res.status(500).send('Internal Server Error');
    }
}

export interface FileContent {
    path: string;
    source: string;
}

// returns details of repo, or undefined if res/Response is an error written
export async function getDetailsFromRepo(email: string, uri: URL, req: Request, res: Response, allowPrivateAccess: boolean) : Promise<any>{
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const octokit = new Octokit();
    try {
        // Fetch repository details to get the default branch
        const repoDetails = await octokit.rest.repos.get({
            owner: owner,
            repo: repo
        });

        return repoDetails.data;
    } catch (publicError: any) {
        if (publicError.status !== 404 && publicError?.response?.data?.message !== 'Not Found') {
            if (publicError.status === 403 && publicError.response.headers['x-ratelimit-remaining'] === '0') {
                // Handle rate limit exceeded error
                const resetTime = publicError.response.headers['x-ratelimit-reset'];
                console.error(`Rate limit exceeded for Public Access to ${repo} Details. Reset time: ${new Date(resetTime * 1000)}`);
            } else {
                console.error(`Error retrieving repo details for ${owner} to ${repo}: ${publicError}`);
            }
            throw publicError;
        }

        console.log(`Public access for ${owner} to ${repo} to get Repo Details, attempting authenticated access`);

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

            // const reposForOrg = await octokit.rest.repos.listForOrg({type: "private", org: "polyverse-appsec"});
            const repoDetails = await octokit.rest.repos.get({
                owner: owner,
                repo: repo
            });

            console.log(`Success Retrieving Repo Details from Private Repo ${repo}`)

            return repoDetails.data;
        } catch (authenticatedError) {
            console.error(`Error retrieving repo data via authenticated access:`, authenticatedError);
            return res.status(500).send('Internal Server Error');
        }
    }
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

        // Assuming the first entry is the root folder and get its name
        const rootFolderName = zipEntries[0].entryName;

        // Skip the first entry and filter out directories
        return zipEntries.slice(1).filter(entry => !entry.isDirectory).map(entry => {
            const relativePath = entry.entryName.replace(rootFolderName, '');
            return {
                path: relativePath,
                source: entry.getData().toString('utf8')
            };
        });
    };

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
        return res
            .status(200)
            .contentType('application/json')
            .send(fileContents);
    } catch (publicError: any) {
        if (publicError.status !== 404 && publicError?.response?.data?.message !== 'Not Found') {
            if (publicError.status === 403 && publicError.response.headers['x-ratelimit-remaining'] === '0') {
                // Handle rate limit exceeded error
                const resetTime = publicError.response.headers['x-ratelimit-reset'];
                console.error(`Rate limit exceeded for Public Access to ${owner} repo ${repo} full source. Reset time: ${new Date(resetTime * 1000)}`);
            } else {
                console.error(`Error retrieving full source for ${owner} from ${repo}:`, publicError);
            }
            return res.status(500).send('Internal Server Error');
        }

        console.log(`Public access for ${repo} to get Full Source failed, attempting authenticated access`);

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
                console.error('Failed to retrieve installation access token');
                return res.status(500).send('Internal Server Error');
            }

            const fileContents : FileContent[] = await downloadAndExtractRepo(archiveUrl, installationAccessToken.token);

            console.log(`Success Retrieving ${fileContents.length} files from Private Repo ${repo}`)

            return res
                .status(200)
                .contentType('application/json')
                .send(fileContents);
        } catch (authenticatedError) {
            console.error(`Error retrieving files via authenticated access:`, authenticatedError);
            return res.status(500).send('Internal Server Error');
        }
    }
}
