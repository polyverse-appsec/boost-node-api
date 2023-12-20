"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const serverless_http_1 = __importDefault(require("serverless-http"));
const rest_1 = require("@octokit/rest");
const auth_app_1 = require("@octokit/auth-app");
const secrets_1 = require("./secrets");
const users_1 = require("./users");
const storage_1 = require("./storage");
const auth_1 = require("./auth");
const app = (0, express_1.default)();
const BoostGitHubAppId = "472802";
app.use(express_1.default.json()); // Make sure to use express.json middleware to parse JSON request body
app.get('/api/get_file_from_uri', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const email = (0, auth_1.validateUser)(req, res);
    if (!email) {
        return;
    }
    if (!req.query.uri) {
        console.error(`URI is required`);
        return res.status(400).send('URI is required');
    }
    const uri = new URL(req.query.uri);
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
    };
    console.log(`Inboumd Request: ${JSON.stringify(payload)}`);
    const user = yield (0, users_1.getUser)(email);
    const installationId = user === null || user === void 0 ? void 0 : user.installationId;
    if (!installationId) {
        return res.status(401).send('Unauthorized');
    }
    // try to get the file from GitHub via public path without authentication
    try {
        const octokit = new rest_1.Octokit();
        const response = yield octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: filePathWithoutBranch
        });
        let fileContent = '';
        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
        }
        else {
            throw new Error('Content not found or not a file');
        }
        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'public';
        res.set('X-Resource-Access', fileVisibility);
        return res.send(fileContent);
    }
    catch (error) {
        if (error.status !== 404) {
            console.error(`Error: retrieving file via public access`, error);
        }
        else if (((_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.message) === 'Not Found') {
            console.error(`Failed to retrieve file via public access`);
        }
        else {
            console.error(`Error: retrieving file via public access`, error);
        }
    }
    try {
        const secretStore = 'boost/GitHubApp';
        const secretKeyPrivateKey = secretStore + '/' + 'private-key';
        const privateKey = yield (0, secrets_1.getSecret)(secretKeyPrivateKey);
        // Configure the auth strategy for Octokit
        const auth = (0, auth_app_1.createAppAuth)({
            appId: BoostGitHubAppId,
            privateKey: privateKey,
            installationId: installationId,
        });
        const octokit = new rest_1.Octokit({
            authStrategy: auth_app_1.createAppAuth,
            auth: {
                appId: BoostGitHubAppId,
                privateKey: privateKey,
                installationId: installationId,
            }
        });
        const response = yield octokit.rest.repos.getContent({
            owner: owner,
            repo: repo,
            path: filePathWithoutBranch
        });
        let fileContent = '';
        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
            console.log(`File returned: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
        }
        else {
            throw new Error('Content not found or not a file');
        }
        // Set the custom header
        // Example: 'X-Resource-Access' or public or private
        const fileVisibility = 'private';
        res.set('X-Resource-Access', fileVisibility);
        return res.send(fileContent);
    }
    catch (error) {
        console.error(`Error:`, error);
        return res.status(500).send('Internal Server Error');
    }
}));
app.get('/api/files/:source/:owner/:project/:pathBase64/:analysisType', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const email = (0, auth_1.validateUser)(req, res);
        if (!email) {
            return;
        }
        const { source, owner, project, pathBase64, analysisType } = req.params;
        if (!source || !owner || !project || !pathBase64 || !analysisType) {
            if (!source) {
                console.error(`Source is required`);
            }
            else if (!owner) {
                console.error(`Owner is required`);
            }
            else if (!project) {
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
        }
        catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(400).send(`Invalid resource path`);
        }
        const data = yield (0, storage_1.getProjectData)(email, (0, storage_1.convertToSourceType)(source), owner, project, decodedPath, analysisType);
        if (!data) {
            console.error(`Resource not found: ${source}, ${owner}, ${project}, ${decodedPath}, ${analysisType}`);
            return res.status(404).send('Resource not found');
        }
    }
    catch (error) {
        console.error(`Handler Error: /api/files/:source/:owner/:project/:pathBase64/:analysisType`, error);
        return res.status(500).send('Internal Server Error');
    }
}));
app.post('/api/files/:source/:owner/:project/:pathBase64/:analysisType', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const email = (0, auth_1.validateUser)(req, res);
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
        }
        catch (error) {
            console.error(`Error decoding path: ${pathBase64}`, error);
            return res.status(400).send('Invalid resource path');
        }
        const data = req.body; // Assuming data is sent directly in the body
        if (!data) {
            return res.status(400).send('No data provided');
        }
        yield (0, storage_1.storeProjectData)(email, (0, storage_1.convertToSourceType)(source), owner, project, decodedPath, analysisType, data);
        res.sendStatus(200);
    }
    catch (error) {
        console.error(`Handler Error: /api/files/:source/:owner/:project/:pathBase64/:analysisType`, error);
        return res.status(500).send('Internal Server Error');
    }
}));
module.exports.getFromFileURI = (0, serverless_http_1.default)(app);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7QUFBQSxzREFBcUQ7QUFDckQsc0VBQXlDO0FBRXpDLHdDQUF3QztBQUN4QyxnREFBa0Q7QUFDbEQsdUNBQXNDO0FBQ3RDLG1DQUFrQztBQUNsQyx1Q0FBOEY7QUFDOUYsaUNBQXNDO0FBRXRDLE1BQU0sR0FBRyxHQUFHLElBQUEsaUJBQU8sR0FBRSxDQUFDO0FBRXRCLE1BQU0sZ0JBQWdCLEdBQUcsUUFBUSxDQUFDO0FBRWxDLEdBQUcsQ0FBQyxHQUFHLENBQUMsaUJBQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsc0VBQXNFO0FBRS9GLEdBQUcsQ0FBQyxHQUFHLENBQUMsd0JBQXdCLEVBQUUsQ0FBTyxHQUFZLEVBQUUsR0FBYSxFQUFFLEVBQUU7O0lBQ3BFLE1BQU0sS0FBSyxHQUFHLElBQUEsbUJBQVksRUFBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7SUFDckMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ1QsT0FBTztJQUNYLENBQUM7SUFFRCxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUNqQixPQUFPLENBQUMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDakMsT0FBTyxHQUFHLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQWEsQ0FBQyxDQUFDO0lBQzdDLElBQUksR0FBRyxDQUFDLFFBQVEsS0FBSyxPQUFPLElBQUksR0FBRyxDQUFDLFFBQVEsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN4RCxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFn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