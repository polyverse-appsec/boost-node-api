import { Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { getSecret } from './secrets';
import { getUser } from './users';


const BoostGitHubAppId = "472802";

export async function get_file_from_uri(email: string, uri: URL, req: Request, res: Response) {
    const [, owner, repo, ...path] = uri.pathname.split('/');
    const filePath = path.join('/');

    const filePathWithoutBranch = filePath.replace(/^blob\/main\//, '');

    const payload = {
        headers: req.headers,
        query: req.query,
        body: req.body
    }

    console.log(`Inboumd Request: ${JSON.stringify(payload)}`);

    const user = await getUser(email);
    const installationId = user?.installationId;
    if (!installationId) {
        return res.status(401).send('Unauthorized');
    }

    // try to get the file from GitHub via public path without authentication
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
        } else {
            throw new Error('Content not found or not a file');
        }

        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'public';
        res.set('X-Resource-Access', fileVisibility);
        res.set('content-type', 'text/plain');
        
        return res.send(fileContent);

    } catch (error: any) {
        if (error.status !== 404) {
            console.error(`Error: retrieving file via public access`, error);
        } else if (error?.response?.data?.message === 'Not Found') {
            console.error(`Failed to retrieve file via public access`);
        } else {
            console.error(`Error: retrieving file via public access`, error);
        }
    }

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
        res.set('X-Resource-Access', fileVisibility);
        res.set('content-type', 'text/plain');

        return res.send(fileContent);
        
    } catch (error) {
        console.error(`Error:`, error);
        return res.status(500).send('Internal Server Error');
    }
}

// stages of of the vectordata are:
// 0: basic project structure
// 1: full project structure
// 2: first 5 files + package.json (if exist)
// 3: first 5 files + package.json (if exist, and using boostignore and gitignore)
// 4: all file data (trimmed to ignore files)
export async function user_project_data_references(uri: URL, stage: number, req: Request, res: Response) : Promise<string> {

    if (stage < 0 || stage > 4) {
        res.status(400).send('Invalid stage');
        return "";
    }

    console.log(`Writing sample vector data: ${uri}`);

    return uri.toString();
}