import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import { getProjectData, storeProjectData, SourceType, convertToSourceType } from './storage';
import { validateUser } from './auth';
import { get_file_from_uri, get_vectordata_from_project } from './github';
import { store_vectordata_for_project } from './openai';

const app = express();

app.use(express.json()); // Make sure to use express.json middleware to parse JSON request body

app.get('/api/get_file_from_uri', async (req: Request, res: Response) => {
    const email = validateUser(req, res);
    if (!email) {
        return;
    }

    if (!req.query.uri) {
        console.error(`URI is required`);
        return res.status(400).send('URI is required');
    }

    const uri = new URL(req.query.uri as string);
    if (uri.protocol !== 'http:' && uri.protocol !== 'https:') {
        console.error(`Invalid URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    get_file_from_uri(email, uri, req, res);
});

app.get('/api/get_vectordata_from_project', async (req: Request, res: Response) => {
    const email = validateUser(req, res);
    if (!email) {
        return;
    }

    if (!req.query.uri) {
        console.error(`URI is required`);
        return res.status(400).send('URI is required');
    }

    const uri = new URL(req.query.uri as string);
    if (uri.protocol !== 'http:' && uri.protocol !== 'https:') {
        console.error(`Invalid URI: ${uri}`);
        return res.status(400).send('Invalid URI');
    }

    // stages of of the vectordata are:
    // 0: basic project structure
    // 1: full project structure
    // 2: first 5 files + package.json (if exist)
    // 3: first 5 files + package.json (if exist, and using boostignore and gitignore)
    // 4: all file data (trimmed to ignore files)
    let stage : number = 0;
    if (req.query.stage) {
        stage = parseInt(req.query.stage as string);
    }

    console.log(`get_vectordata_from_project: Request validated uri: {uri} stage: {stage}`);

    const vectorData : string = await get_vectordata_from_project(uri, stage, req, res);
    if (!vectorData) {
        return res;
    }

    console.log(`get_vectordata_from_project: retrieved vectorData`);

    try {
        await store_vectordata_for_project(uri, vectorData, req, res);
    } catch (error) {
        console.error(`Handler Error: get_vectordata_from_project: Unable to store vector data:`, error);
        console.error(`Error storing vector data:`, error);
        return res.status(500).send('Internal Server Error');
    }

    console.log(`store_vectordata_for_project: retrieved id`);
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

        const data = await getProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType);
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

        await storeProjectData(email, convertToSourceType(source), owner, project, decodedPath, analysisType, data);
        res.sendStatus(200);

    } catch (error) {
        console.error(`Handler Error: /api/files/:source/:owner/:project/:pathBase64/:analysisType`, error);
        return res.status(500).send('Internal Server Error');
    }
});

app.get("/test", (req, res, next) => {
    // Set the content type to text
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Write initial part of the response
    res.write("Hello ");

    // Use a setInterval to send data in intervals
    const intervalId = setInterval(() => {
        res.write("world ");
    }, 1000); // Sends "world " every second

    // Stop sending data after 5 seconds
    setTimeout(() => {
        clearInterval(intervalId);
        res.end("Goodbye!"); // End the response with a final message
    }, 5000);
});

module.exports.handler = serverless(app);