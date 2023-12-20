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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSecret = exports.getSecrets = void 0;
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const client = new client_secrets_manager_1.SecretsManagerClient({ region: "us-west-2" });
function getSecrets(secretName) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const command = new client_secrets_manager_1.GetSecretValueCommand({ SecretId: secretName });
            const rawSecretData = yield client.send(command);
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
function getSecret(secretName) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const command = new client_secrets_manager_1.GetSecretValueCommand({ SecretId: secretName });
            const rawSecretData = yield client.send(command);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjcmV0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zZWNyZXRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUFBLDRFQUE4RjtBQU05RixNQUFNLE1BQU0sR0FBRyxJQUFJLDZDQUFvQixDQUFDLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFFakUsU0FBZSxVQUFVLENBQUMsVUFBa0I7O1FBQzFDLElBQUksQ0FBQztZQUNILE1BQU0sT0FBTyxHQUFHLElBQUksOENBQXFCLENBQUMsRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztZQUNwRSxNQUFNLGFBQWEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDakQsSUFBSSxhQUFhLENBQUMsWUFBWSxFQUFFLENBQUM7Z0JBQy9CLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDaEQsQ0FBQztZQUNELE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUNoRCxDQUFDO1FBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztZQUNiLE9BQU8sQ0FBQyxLQUFLLENBQUMsaUNBQWlDLFVBQVUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQ25FLE1BQU0sR0FBRyxDQUFDO1FBQ1osQ0FBQztJQUNILENBQUM7Q0FBQTtBQWdCUSxnQ0FBVTtBQWRuQixTQUFlLFNBQVMsQ0FBQyxVQUFrQjs7UUFDekMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSw4Q0FBcUIsQ0FBQyxFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBQ3BFLE1BQU0sYUFBYSxHQUFHLE1BQU0sTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNqRCxJQUFJLGFBQWEsQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDL0IsT0FBTyxhQUFhLENBQUMsWUFBWSxDQUFDO1lBQ3BDLENBQUM7WUFDRCxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixDQUFDLENBQUM7UUFDaEQsQ0FBQztRQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxVQUFVLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztZQUNuRSxNQUFNLEdBQUcsQ0FBQztRQUNaLENBQUM7SUFDSCxDQUFDO0NBQUE7QUFFb0IsOEJBQVMifQ==