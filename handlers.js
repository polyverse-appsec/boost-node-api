"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.getFromFileURI = void 0;
const AWS = __importStar(require("aws-sdk"));
const express_1 = __importDefault(require("express"));
const serverless_http_1 = __importDefault(require("serverless-http"));
const rest_1 = require("@octokit/rest");
const auth_app_1 = require("@octokit/auth-app");
const secrets_1 = require("./secrets");
const app = (0, express_1.default)();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const installationsKeyValueStore = 'Boost.GitHub-App.installations';
const BoostGitHubAppId = "472802";
app.use(express_1.default.json()); // Use express.json middleware to parse JSON request body
app.get('/api/get_file_from_uri', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    if (!req.query.uri) {
        console.error(`URI is required`);
        return res.status(400).send('URI is required');
    }
    if (!req.query.email) {
        console.error(`Unauthorized:  Email is required`);
        return res.status(401).send('Unauthorized');
    }
    const email = normalizeEmail(req.query.email);
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
    let installationId;
    try {
        const params = {
            TableName: installationsKeyValueStore,
            Key: { email }
        };
        const userInfo = yield dynamoDB.get(params).promise();
        installationId = (_a = userInfo.Item) === null || _a === void 0 ? void 0 : _a.installationId; // Add null check here
        const installingUser = (_b = userInfo.Item) === null || _b === void 0 ? void 0 : _b.username; // Add null check here
    }
    catch (error) {
        console.error(`Error retrieving installation user info:`, error);
        return res.status(401).send('Unauthorized');
    }
    try {
        const octokit = new rest_1.Octokit();
        const response = yield octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePathWithoutBranch
        });
        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            const fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
            return res.send(fileContent);
        }
        else {
            throw new Error('Content not found or not a file');
        }
    }
    catch (error) {
        if (error.status !== 404) {
            console.error(`Error: retrieving file via public access`, error);
        }
        else if (((_d = (_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.message) === 'Not Found') {
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
        const octokit = new rest_1.Octokit({
            authStrategy: auth_app_1.createAppAuth,
            auth: {
                appId: BoostGitHubAppId,
                privateKey,
                installationId
            }
        });
        const response = yield octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePathWithoutBranch
        });
        // Check if response is for a single file and has content
        if ("content" in response.data && typeof response.data.content === 'string') {
            const fileContent = Buffer.from(response.data.content, 'base64').toString('utf8');
            console.log(`File returned: Owner: ${owner}, Repo: ${repo}, Path: ${filePathWithoutBranch}`);
            return res.send(fileContent);
        }
        else {
            throw new Error('Content not found or not a file');
        }
    }
    catch (error) {
        console.error(`Error:`, error);
        return res.status(500).send('Internal Server Error');
    }
}));
function normalizeEmail(email) {
    email = email.toLowerCase();
    return email.replace(/@polytest\.ai$/i, '@polyverse.com');
}
exports.getFromFileURI = (0, serverless_http_1.default)(app);
