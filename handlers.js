const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const { getSecret } = require('./secrets');

const app = express();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const installationsKeyValueStore = 'Boost.GitHub-App.installations';
const BoostGitHubAppId = "472802";

app.use(express.json()); // Make sure to use express.json middleware to parse JSON request body

app.get('/api/get_file_from_uri', async (req, res) => {

    // Assume the URI is passed as a query parameter
    // For example, /api/get_file_from_uri?uri=...
    // URI should be in the format "http://github.com/owner/repo/path_to_file"
    if (!req.query.uri) {
        return res.status(400).send('URI is required');
    }

    if (!req.query.email) {
        return res.status(401).send('Unauthorized');
    }

    email = req.query.email;

    const uri = new URL(req.query.uri);
    if (uri.protocol !== 'http:' && uri.protocol !== 'https:') {
        return res.status(400).send('Invalid URI');
    }
    const [_, owner, repo, ...path] = uri.pathname.split('/');
    const filePath = path.join('/');

    // remove the leading blob/main/ from the path
    const filePathWithoutBranch = filePath.replace(/^blob\/main\//, '');

    // Get user information, including email address
    let installationId;
    try {
        // load from DynamoDB
        const params = {
            TableName: installationsKeyValueStore,
            Key: {
                email: email
            }
        };

        const userInfo = await dynamoDB.get(params).promise();

        installationId = userInfo.Item.installationId;
        const installingUser = userInfo.Item.username;

    } catch (error) {

        console.error(`Error retrieving installation user info:`, error);

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
        return res.send(fileContent);

    } catch (error) {
        console.error(`Error: retrieving file via public access`, error);
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
        return res.send(fileContent);

    } catch (error) {
        console.error(`Error:`, error);
        return res.status(500).send('Internal Server Error');
    }
});

module.exports.getFromFileURI = serverless(app);
