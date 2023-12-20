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
exports.saveUser = exports.getUser = void 0;
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const dynamoDB = new aws_sdk_1.default.DynamoDB.DocumentClient();
const installationsKeyValueStore = 'Boost.GitHub-App.installations';
function getUser(email) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const params = {
                TableName: installationsKeyValueStore,
                Key: { email } // primary key
            };
            const userInfo = yield dynamoDB.get(params).promise();
            if (!userInfo.Item)
                return undefined;
            const installationId = userInfo.Item.installationId;
            const username = userInfo.Item.username;
            return { installationId, username };
        }
        catch (error) {
            console.error(`Error retrieving installation user info:`, error);
            return undefined;
        }
    });
}
exports.getUser = getUser;
function saveUser(email, installationId, username) {
    return __awaiter(this, void 0, void 0, function* () {
        const params = {
            TableName: installationsKeyValueStore,
            Item: {
                email, // primary key
                installationId,
                username,
            },
        };
        try {
            yield dynamoDB.put(params).promise();
        }
        catch (error) {
            console.error(`Error saving user:`, error);
        }
    });
}
exports.saveUser = saveUser;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvdXNlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsc0RBQTBCO0FBRTFCLE1BQU0sUUFBUSxHQUFHLElBQUksaUJBQUcsQ0FBQyxRQUFRLENBQUMsY0FBYyxFQUFFLENBQUM7QUFDbkQsTUFBTSwwQkFBMEIsR0FBRyxnQ0FBZ0MsQ0FBQztBQUVwRSxTQUFzQixPQUFPLENBQUMsS0FBYTs7UUFDdkMsSUFBSSxDQUFDO1lBQ0QsTUFBTSxNQUFNLEdBQUc7Z0JBQ1gsU0FBUyxFQUFFLDBCQUEwQjtnQkFDckMsR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLENBQUMsY0FBYzthQUNoQyxDQUFDO1lBRUYsTUFBTSxRQUFRLEdBQUcsTUFBTSxRQUFRLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBRXRELElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSTtnQkFBRSxPQUFPLFNBQVMsQ0FBQztZQUVyQyxNQUFNLGNBQWMsR0FBVyxRQUFRLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQztZQUM1RCxNQUFNLFFBQVEsR0FBVyxRQUFRLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztZQUVoRCxPQUFPLEVBQUUsY0FBYyxFQUFFLFFBQVEsRUFBRSxDQUFDO1FBQ3hDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQywwQ0FBMEMsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUNqRSxPQUFPLFNBQVMsQ0FBQztRQUNyQixDQUFDO0lBQ0wsQ0FBQztDQUFBO0FBbkJELDBCQW1CQztBQUVELFNBQXNCLFFBQVEsQ0FBQyxLQUFhLEVBQUUsY0FBc0IsRUFBRSxRQUFnQjs7UUFDbEYsTUFBTSxNQUFNLEdBQUc7WUFDWCxTQUFTLEVBQUUsMEJBQTBCO1lBQ3JDLElBQUksRUFBRTtnQkFDRixLQUFLLEVBQUUsY0FBYztnQkFDckIsY0FBYztnQkFDZCxRQUFRO2FBQ1g7U0FDSixDQUFDO1FBRUYsSUFBSSxDQUFDO1lBQ0QsTUFBTSxRQUFRLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3pDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMvQyxDQUFDO0lBQ0wsQ0FBQztDQUFBO0FBZkQsNEJBZUMifQ==