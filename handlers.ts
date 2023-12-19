import * as AWS from 'aws-sdk';
import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { getSecret } from './secrets';

const app = express();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const installationsKeyValueStore = 'Boost.GitHub-App.installations';
const BoostGitHubAppId = "472802";

app.use(express.json()); // Use express.json middleware to parse JSON request body

app.get('/api/get_file_from_uri', async (req: Request, res: Response) => {
    if (!req.query.uri) {
        console.error(`URI is required`);
        return res.status(400).send('URI is required');
    }

    if (!req.query.email) {
        console.error(`Unauthorized:  Email is required`);
        return res.status(401).send('Unauthorized');
    }

    const email = normalizeEmail(req.query.email as string);

    const uri = new URL(req.query.uri as string);
    if (uri.protocol !== 'http:' && uri.protocol !== 'https:') {
        console.error(`Invalid URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }
    const [, owner, repo, ...path] = uri.pathname.split('/');
    const filePath = path.join('/');

    const filePathWithoutBranch = filePath.replace(/^blob\/main\//, '');

    const payload = {
        headers: req.headers,
        query: req.query,
        body: req.body
    }

    console.log(`Inboumd Request: ${JSON.stringify(payload)}`);

    let installationId: string;
    try {
        const params = {
            TableName: installationsKeyValueStore,
            Key: { email }
        };

        const userInfo = await dynamoDB.get(params).promise();
        installationId = userInfo.Item?.installationId; // Add null check here
        const installingUser = userInfo.Item?.username; // Add null check here

    } catch (error) {
        console.error(`Error retrieving installation user info:`, error);
        return res.status(401).send('Unauthorized');
    }

    try {
        const octokit = new Octokit();
        const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePathWithoutBranch
        });

        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            const fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
            return res.send(fileContent);
        } else {
            throw new Error('Content not found or not a file');
        }

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

        const octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: BoostGitHubAppId,
                privateKey,
                installationId
            }
        });

        const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePathWithoutBranch
        });

        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            const fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
            console.log(`File returned: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
            return res.send(fileContent);
        } else {
            throw new Error('Content not found or not a file');
        }

    } catch (error: any) {
        console.error(`Error:`, error);
        return res.status(500).send('Internal Server Error');
    }
});

function normalizeEmail(email: string): string {
    email = email.toLowerCase();
    return email.replace(/@polytest\.ai$/i, '@polyverse.com');
}

export const getFromFileURI = serverless(app);
