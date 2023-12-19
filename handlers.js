// print the version of the app - from env variable APP_VERSION
console.log(`App version: ${process.env.APP_VERSION}`);

const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const { getSecret } = require('./secrets');
const { getUser } = require('./users');
const { getProjectData, storeProjectData, SourceType } = require('./storage');
const { validateUser } = require('./auth');

const app = express();

const BoostGitHubAppId = "472802";

app.use(express.json()); // Make sure to use express.json middleware to parse JSON request body

app.get('/api/get_file_from_uri', async (req, res) => {
    const email = validateUser(req, res);
    if (!email) {
        return;
    }

    // Assume the URI is passed as a query parameter
    // For example, /api/get_file_from_uri?uri=...
    // URI should be in the format "http://github.com/owner/repo/path_to_file"
    if (!req.query.uri) {
        console.error(`URI is required`);
        return res.status(400).send('URI is required');
    }

    const uri = new URL(req.query.uri);
    if (uri.protocol !== 'http:' && uri.protocol !== 'https:') {
        console.error(`Invalid URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }
    const [_, owner, repo, ...path] = uri.pathname.split('/');
    const filePath = path.join('/');

    // remove the leading blob/main/ from the path
    const filePathWithoutBranch = filePath.replace(/^blob\/main\//, '');

    const payload = {
        headers: req.headers,
        query: req.query,
        body: req.body
    }

    console.log(`Inboumd Request: ${JSON.stringify(payload)}`);

    const installationId = await getUser(email)?.installationId;
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

        // Assuming the file is small and can be sent as a response
        const fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');

        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'public';
        res.set('X-Resource-Access', fileVisibility);
        
        return res.send(fileContent);

    } catch (error) {
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

        // Assuming the file is small and can be sent as a response
        const fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
        console.log(`File returned: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);

        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'private';
        res.set('X-Resource-Access', fileVisibility);

        return res.send(fileContent);
        
    } catch (error) {
        console.error(`Error:`, error);
        return res.status(500).send('Internal Server Error');
    }
});

app.get('/api/files/:source/:owner/:project/:pathBase64/:analysisType', async (req, res) => {
    try {
        const email = validateUser(req, res);
        if (!email) {
            return;
        }

        const { source, owner, project, pathBase64, analysisType } = req.params;

        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            if (!source) {
                console.error(`Source is required`);
            } else if (!owner) {
                console.error(`Owner is required`);
            } else if (!project) {
                console.error(`Project is required`);
            }
            else if (!pathBase64) {
                console.error(`Path is required`);
            }
            else if (!analysisType) {
                console.error(`Analysis type is required`);
            }
            return res.status(400).send('Invalid resource path');
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(400).send(`Invalid resource path`);
        }

        const data = await getProjectData(email, source, owner, project, decodedPath, analysisType);
        if (!data) {
            console.error(`Resource not found: ${source}, ${owner}, ${project}, ${decodedPath}, ${analysisType}`);
            return res.status(404).send('Resource not found');
        }
    } catch (error) {
        console.error(`Handler Error: /api/files/:source/:owner/:project/:pathBase64/:analysisType`, error);
        return res.status(500).send('Internal Server Error');
    }
});

app.post('/api/files/:source/:owner/:project/:pathBase64/:analysisType', async (req, res) => {
    try {
        const email = validateUser(req, res);
        if (!email) {
            return res.status(401).send('Unauthorized');
        }

        const { source, owner, project, pathBase64, analysisType } = req.params;

        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            console.error('Missing required parameters in request:', req.params);
            return res.status(400).send('Invalid resource path');
        }

        let decodedPath;
        try {
            decodedPath = Buffer.from(pathBase64, 'base64').toString('utf8');
        } catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(400).send('Invalid resource path');
        }

        const data = req.body; // Assuming data is sent directly in the body
        if (!data) {
            return res.status(400).send('No data provided');
        }

        await storeProjectData(email, source, owner, project, decodedPath, analysisType, data);
        res.sendStatus(200);

    } catch (error) {
        console.error(`Handler Error: /api/files/:source/:owner/:project/:pathBase64/:analysisType`, error);
        return res.status(500).send('Internal Server Error');
    }
});

module.exports.getFromFileURI = serverless(app);
