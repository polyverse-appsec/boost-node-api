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
const secrets_1 = require("./src/secrets");
const users_1 = require("./src/users");
const storage_1 = require("./src/storage");
const auth_1 = require("./src/auth");
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
app.get("/", (req, res, next) => {
    return res.status(200).json({
        message: "Hello from root!",
    });
});
module.exports.handler = (0, serverless_http_1.default)(app);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7OztBQUFBLHNEQUFxRDtBQUNyRCxzRUFBeUM7QUFDekMsd0NBQXdDO0FBQ3hDLGdEQUFrRDtBQUNsRCwyQ0FBMEM7QUFDMUMsdUNBQXNDO0FBQ3RDLDJDQUFrRztBQUNsRyxxQ0FBMEM7QUFFMUMsTUFBTSxHQUFHLEdBQUcsSUFBQSxpQkFBTyxHQUFFLENBQUM7QUFFdEIsTUFBTSxnQkFBZ0IsR0FBRyxRQUFRLENBQUM7QUFFbEMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxpQkFBTyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxzRUFBc0U7QUFFL0YsR0FBRyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsRUFBRSxDQUFPLEdBQVksRUFBRSxHQUFhLEVBQUUsRUFBRTs7SUFDcEUsTUFBTSxLQUFLLEdBQUcsSUFBQSxtQkFBWSxFQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUNyQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDVCxPQUFPO0lBQ1gsQ0FBQztJQUVELElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ2pCLE9BQU8sQ0FBQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNqQyxPQUFPLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUM7SUFDbkQsQ0FBQztJQUVELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBYSxDQUFDLENBQUM7SUFDN0MsSUFBSSxHQUFHLENBQUMsUUFBUSxLQUFLLE9BQU8sSUFBSSxHQUFHLENBQUMsUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQ3hELE9BQU8sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEdBQUcs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