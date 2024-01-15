import { Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { getSingleSecret } from './secrets';
import { getUser } from './users';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { App } from "octokit";


const BoostGitHubAppId = "472802";

export async function getFileFromRepo(email: string, uri: URL, req: Request, res: Response, allowPrivateAccess: boolean): Promise<any> {
    const [, owner, repo, ...path] = uri.pathname.split('/');

    if (!owner || !repo || path.length === 0) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const filePath = path.join('/');
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

        return res
            .status(200)
            .set('X-Resource-Access', 'public')
            .contentType('text/plain')
            .send(fileContent);

    } catch (error : any) {
        if (error.status !== 404 && error?.response?.data?.message !== 'Not Found') {
            console.error(`Error: retrieving file via public access`, error);
            return res.status(500).send('Internal Server Error');
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
                res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return undefined;
            }
        }
        const installationId = user?.installationId;
        if (!installationId) {
            console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            return undefined;
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
    
        try {
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
        } catch (error) {
            console.error(`Error retrieving folder paths from ${path}:`, error);
            throw error;
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
    } catch (error) {
        console.error(`Error retrieving folders via public access:`, error);
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
                res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return undefined;
            }
        }
        const installationId = user?.installationId;
        if (!installationId) {
            console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            return undefined;
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

        try {
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
        } catch (error) {
            console.error(`Error retrieving file paths from ${path}:`, error);
            throw error;
        }

        return filePaths;
    };

    // Try to get the files from GitHub via public path without authentication
    try {
        const octokit = new Octokit();
        const filePaths = await getFilePaths(octokit, owner, repo);

        return res
            .status(200)
            .contentType('application/json')
            .send(filePaths);
    } catch (error) {
        console.error(`Error retrieving files via public access:`, error);
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
                res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return undefined;
            }
        }
        const installationId = user?.installationId;
        if (!installationId) {
            console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
            return undefined;
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

        const filePaths = await getFilePaths(octokit, owner, repo);

        return res
            .set('X-Resource-Access', 'private')
            .status(200)
            .contentType('application/json')
            .send(filePaths);

    } catch (error) {
        console.error(`Error retrieving files via private access:`, error);
        return res.status(500).send('Internal Server Error');
    }
}

interface FileContent {
    path: string;
    source: string;
}

// returns details of repo, or undefined if res/Response is an error written
export async function getDetailsFromRepo(email: string, uri: URL, req: Request, res: Response, allowPrivateAccess: boolean) : Promise<any>{
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        res.status(400).send('Invalid URI');
        return undefined;
    }

    const octokit = new Octokit();
    try {
        // Fetch repository details to get the default branch
        const repoDetails = await octokit.rest.repos.get({
            owner: owner,
            repo: repo
        });

        return repoDetails.data;
    } catch (publicError) {
        console.log('Public access failed, attempting authenticated access');

        if (!allowPrivateAccess) {
            console.error(`Error: Private Access Not Allowed for this Plan: ${repo}`);
            res.status(401).send('Access to Private GitHub Resources is not allowed for this Account');
            return undefined;
        }
    
        // Public access failed, switch to authenticated access
        try {
            // try by the repo org first, then by the user
            let user = await getUser(owner);
            if (!user) {
                user = await getUser(email);
                if (!user) {
                    console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                    res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                    return undefined;
                }
            }
            const installationId = user?.installationId;
            if (!installationId) {
                console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return undefined;
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

            return repoDetails.data;
        } catch (authenticatedError) {
            console.error(`Error retrieving repo data via authenticated access:`, authenticatedError);
            res.status(500).send('Internal Server Error');
            return undefined;
        }
    }
}

export async function getFullSourceFromRepo(email: string, uri: URL, req: Request, res: Response, allowPrivateAccess: boolean) {
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const downloadAndExtractRepo = async (url: string): Promise<FileContent[]> => {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer'
            });
            const zip = new AdmZip(response.data);
            const zipEntries = zip.getEntries();

            return zipEntries.map(entry => ({
                path: entry.entryName,
                source: entry.getData().toString('utf8')
            }));
        } catch (error) {
            console.error(`Error downloading or extracting repository:`, error);
            throw error;
        }
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
        const publicArchiveUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${defaultBranch}`;

        const fileContents = await downloadAndExtractRepo(publicArchiveUrl);
        return res
            .status(200)
            .contentType('application/json')
            .send(fileContents);
    } catch (publicError) {
        console.log('Public access failed, attempting authenticated access');

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
                    res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                    return undefined;
                }
            }
            const installationId = user?.installationId;
            if (!installationId) {
                console.error(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                res.status(400).send(`Error: GitHub App Installation not found - ensure GitHub App is installed to access private source code: ${email} or ${owner}`);
                return undefined;
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
            
            const archiveUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${defaultBranch}`;
        
            const fileContents = await downloadAndExtractRepo(archiveUrl);
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
