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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSecret = exports.getSecrets = void 0;
const AWS = __importStar(require("aws-sdk"));
function getSecrets(secretName, region = 'us-west-2') {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new AWS.SecretsManager({ region });
        try {
            const rawSecretData = yield client.getSecretValue({ SecretId: secretName }).promise();
            if (rawSecretData.SecretString) {
                return JSON.parse(rawSecretData.SecretString);
            }
            throw new Error('Secret string is undefined');
        }
        catch (err) {
            console.error(`Error retrieving secrets from ${secretName}:`, err);
            throw err;
        }
    });
}
exports.getSecrets = getSecrets;
function getSecret(secretName, region = 'us-west-2') {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new AWS.SecretsManager({ region });
        try {
            const rawSecretData = yield client.getSecretValue({ SecretId: secretName }).promise();
            if (rawSecretData.SecretString) {
                return rawSecretData.SecretString;
            }
            throw new Error('Secret string is undefined');
        }
        catch (err) {
            console.error(`Error retrieving secrets from ${secretName}:`, err);
            throw err;
        }
    });
}
exports.getSecret = getSecret;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjcmV0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zZWNyZXRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNkNBQStCO0FBTS9CLFNBQWUsVUFBVSxDQUFDLFVBQWtCLEVBQUUsU0FBaUIsV0FBVzs7UUFDeEUsTUFBTSxNQUFNLEdBQUcsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUNsRCxJQUFJLENBQUM7WUFDSCxNQUFNLGFBQWEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxjQUFjLENBQUMsRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0RixJQUFJLGFBQWEsQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDL0IsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUNoRCxDQUFDO1lBQ0QsTUFBTSxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDO1FBQ2hELENBQUM7UUFBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsVUFBVSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDbkUsTUFBTSxHQUFHLENBQUM7UUFDWixDQUFDO0lBQ0gsQ0FBQztDQUFBO0FBZ0JRLGdDQUFVO0FBZG5CLFNBQWUsU0FBUyxDQUFDLFVBQWtCLEVBQUUsU0FBaUIsV0FBVzs7UUFDdkUsTUFBTSxNQUFNLEdBQUcsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUNsRCxJQUFJLENBQUM7WUFDSCxNQUFNLGFBQWEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxjQUFjLENBQUMsRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0RixJQUFJLGFBQWEsQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDL0IsT0FBTyxhQUFhLENBQUMsWUFBWSxDQUFDO1lBQ3BDLENBQUM7WUFDRCxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixDQUFDLENBQUM7UUFDaEQsQ0FBQztRQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxVQUFVLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUNuRSxNQUFNLEdBQUcsQ0FBQztRQUNaLENBQUM7SUFDSCxDQUFDO0NBQUE7QUFFb0IsOEJBQVMifQ==