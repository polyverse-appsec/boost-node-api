import { Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { getSecret } from './secrets';
import { getUser } from './users';


const BoostGitHubAppId = "472802";

export async function get_file_from_uri(email: string, uri: URL, req: Request, res: Response) {
    const [, owner, repo, ...path] = uri.pathname.split('/');

    if (!owner || !repo || !path) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const filePath = path.join('/');

    const filePathWithoutBranch = filePath.replace(/^blob\/(main|master)\//, '');

    const payload = {
        headers: req.headers,
        query: req.query,
        body: req.body
    }

    console.log(`Inboumd Request: ${JSON.stringify(payload)}`);

    // try to get the file from GitHub via public path without authentication
    console.log(`Attempting to retrieve file via public access: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
    try {
        const octokit = new Octokit();
        const response = await octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: filePathWithoutBranch
        });

        let fileContent = '';

        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
        } else if (Array.isArray(response.data)) {
            console.error(`Error: Content retrieved from uri is not a string: ${uri}`);
            return res.status(400).send('Invalid URI');
        } else {
            throw new Error('Content not found or not a file');
        }

        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'public';
        
        res
            .status(200)
            .set('X-Resource-Access', fileVisibility)
            .set('content-type', 'text/plain')
            .send(fileContent);

    } catch (error: any) {
        if (error.status !== 404) {
            console.error(`Error: retrieving file via public access`, error);
        } else if (error?.response?.data?.message === 'Not Found') {
            console.error(`Failed to retrieve file via public access`);
        } else {
            console.error(`Error: retrieving file via public access`, error);
        }
    }


    const user = await getUser(email);
    const installationId = user?.installationId;
    if (!installationId) {
        console.error(`Error: Git User not found or no installationId - ensure GitHub App is installed to access private source code: ${email}`);
        return res.status(401).send('Unauthorized');
    }

    // try to get the file from GitHub via private path with authentication
    console.log(`Attempting to retrieve file via private access: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
    try {

        const secretStore = 'boost/GitHubApp';
        const secretKeyPrivateKey = secretStore + '/' + 'private-key';

        const privateKey = await getSecret(secretKeyPrivateKey);

        // Configure the auth strategy for Octokit
        const auth = createAppAuth({
            appId: BoostGitHubAppId,
            privateKey: privateKey,
            installationId: installationId,
        });

        const octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: BoostGitHubAppId,
                privateKey: privateKey,
                installationId: installationId,
            }
        });

        const response = await octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: filePathWithoutBranch
        });

        let fileContent = '';
        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
            console.log(`File returned: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
        } else {
            throw new Error('Content not found or not a file');
        }

        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'private';

        res
            .status(200)
            .set('X-Resource-Access', fileVisibility)
            .set('content-type', 'text/plain')
            .send(fileContent);
        
    } catch (error) {
        console.error(`Error:`, error);
        return res.status(500).send('Internal Server Error');
    }
}


export async function getGitHubFile(email: string, uri: URL, req: Request, res: Response) : Promise<any> {
    const [, owner, repo, ...path] = uri.pathname.split('/');

    if (!owner || !repo || !path) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const filePath = path.join('/');

    const filePathWithoutBranch = filePath.replace(/^blob\/(main|master)\//, '');

    const payload = {
        headers: req.headers,
        query: req.query,
        body: req.body
    }

    console.log(`Inboumd Request: ${JSON.stringify(payload)}`);

    // try to get the file from GitHub via public path without authentication
    console.log(`Attempting to retrieve file via public access: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
    try {
        const octokit = new Octokit();
        const response = await octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: filePathWithoutBranch
        });

        let fileContent = '';

        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
        } else if (Array.isArray(response.data)) {
            console.error(`Error: Content retrieved from uri is not a string: ${uri}`);
            return res.status(400).send('Invalid URI');
        } else {
            throw new Error('Content not found or not a file');
        }

        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'public';
        
        return res
            .status(200)
            .set('X-Resource-Access', fileVisibility)
            .set('content-type', 'text/plain')
            .send(fileContent);

    } catch (error: any) {
        if (error.status !== 404) {
            console.error(`Error: retrieving file via public access`, error);
        } else if (error?.response?.data?.message === 'Not Found') {
            console.error(`Failed to retrieve file via public access`);
        } else {
            console.error(`Error: retrieving file via public access`, error);
        }
    }


    const user = await getUser(email);
    const installationId = user?.installationId;
    if (!installationId) {
        console.error(`Error: Git User not found or no installationId - ensure GitHub App is installed to access private source code: ${email}`);
        return res.status(401).send('Unauthorized');
    }

    // try to get the file from GitHub via private path with authentication
    console.log(`Attempting to retrieve file via private access: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
    try {

        const secretStore = 'boost/GitHubApp';
        const secretKeyPrivateKey = secretStore + '/' + 'private-key';

        const privateKey = await getSecret(secretKeyPrivateKey);

        // Configure the auth strategy for Octokit
        const auth = createAppAuth({
            appId: BoostGitHubAppId,
            privateKey: privateKey,
            installationId: installationId,
        });

        const octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: BoostGitHubAppId,
                privateKey: privateKey,
                installationId: installationId,
            }
        });

        const response = await octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: filePathWithoutBranch
        });

        let fileContent = '';
        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
            console.log(`File returned: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
        } else {
            throw new Error('Content not found or not a file');
        }

        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'private';

        return res
            .status(200)
            .set('X-Resource-Access', fileVisibility)
            .set('content-type', 'text/plain')
            .send(fileContent);
        
    } catch (error) {
        console.error(`Error:`, error);
        return res.status(500).send('Internal Server Error');
    }
}

export async function getFolderPathsFromRepo(email: string, uri: URL, req: Request, res: Response) {
    const [, owner, repo] = uri.pathname.split('/');

    if (!owner || !repo) {
        console.error(`Error: Invalid GitHub.com resource URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    const getFolderPaths = async (octokit : Octokit, owner: string, repo: string) => {
        try {
            const response = await octokit.rest.repos.getContent({
                owner: owner,
                repo: repo,
                path: '' // Root directory
            });

            if (!Array.isArray(response.data)) {
                throw new Error('Expected directory content, got something else');
            }

            return response.data
                // Filter out folders that start with .
                .filter(item => !item.name.startsWith('.'))
                
                .filter(item => item.type === 'dir')
                .map(dir => dir.path);
        } catch (error) {
            console.error(`Error retrieving folder paths:`, error);
            throw error;
        }
    };

    // Try to get the folders from GitHub via public path without authentication
    try {
        const octokit = new Octokit();
        const folderPaths = await getFolderPaths(octokit, owner, repo);

        return res
            .status(200)
            .header('Content-Type', 'application/json')
            .send(JSON.stringify(folderPaths));
    } catch (error) {
        console.error(`Error retrieving folders via public access:`, error);
    }

    // Private access part
    try {
        const user = await getUser(email);
        const installationId = user?.installationId;
        if (!installationId) {
            console.error(`Error: Git User not found or no installationId - ensure GitHub App is installed to access private source code: ${email}`);
            return res.status(401).send('Unauthorized');
        }

        const secretStore = 'boost/GitHubApp';
        const secretKeyPrivateKey = secretStore + '/' + 'private-key';
        const privateKey = await getSecret(secretKeyPrivateKey);

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
            .header('Content-Type', 'application/json')
            .send(JSON.stringify(folderPaths));

    } catch (error) {
        console.error(`Error retrieving folders via private access:`, error);
        return res.status(500).send('Internal Server Error');
    }
}
