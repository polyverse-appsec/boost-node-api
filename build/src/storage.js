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
exports.storeProjectData = exports.getProjectData = exports.convertToSourceType = exports.SourceType = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client = new client_dynamodb_1.DynamoDBClient({ region: "us-west-2" });
const dynamoDB = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
const analysisDatastoreTableName = 'Boost.AnalysisDataStore';
var SourceType;
(function (SourceType) {
    SourceType["GitHub"] = "github";
    SourceType["General"] = "blob";
})(SourceType || (exports.SourceType = SourceType = {}));
// Function to convert string to SourceType
function convertToSourceType(source) {
    return Object.values(SourceType).find(type => type === source) || SourceType.General;
}
exports.convertToSourceType = convertToSourceType;
function getProjectData(email, sourceType, owner, project, resourcePath, analysisType) {
    return __awaiter(this, void 0, void 0, function* () {
        const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
        const dataPath = `${resourcePath}/${analysisType}`;
        console.log(`getProjectData for: ${projectPath}/${dataPath}`);
        const params = {
            TableName: analysisDatastoreTableName,
            Key: {
                tableKey: projectPath, // primary key
                dataPath: dataPath // secondary/sort key
            }
        };
        try {
            const data = yield dynamoDB.send(new lib_dynamodb_1.GetCommand(params));
            return data.Item ? data.Item.data : undefined;
        }
        catch (error) {
            console.error(`Error getting project data: ${error}`);
            throw error;
        }
    });
}
exports.getProjectData = getProjectData;
function storeProjectData(email, sourceType, owner, project, resourcePath, analysisType, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
        const dataPath = `${resourcePath}/${analysisType}`;
        const dataSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
        console.log(`storeProjectData for (${dataSize} bytes): ${projectPath}/${dataPath}`);
        const params = {
            TableName: analysisDatastoreTableName,
            Item: {
                tableKey: projectPath, // primary key
                dataPath: dataPath, // secondary/sort key
                data: data
            }
        };
        try {
            yield dynamoDB.send(new lib_dynamodb_1.PutCommand(params));
        }
        catch (error) {
            console.error(`Error storing project data: ${error}`);
            throw error;
        }
    });
}
exports.storeProjectData = storeProjectData;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zdG9yYWdlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7OztBQUFBLDhEQUEwRDtBQUMxRCx3REFBdUY7QUFFdkYsTUFBTSxNQUFNLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFDM0QsTUFBTSxRQUFRLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBRXJELE1BQU0sMEJBQTBCLEdBQUcseUJBQXlCLENBQUM7QUFFN0QsSUFBWSxVQUdYO0FBSEQsV0FBWSxVQUFVO0lBQ2xCLCtCQUFpQixDQUFBO0lBQ2pCLDhCQUFnQixDQUFBO0FBQ3BCLENBQUMsRUFIVyxVQUFVLDBCQUFWLFVBQVUsUUFHckI7QUFFRCwyQ0FBMkM7QUFDM0MsU0FBZ0IsbUJBQW1CLENBQUMsTUFBYztJQUM5QyxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUM7QUFDekYsQ0FBQztBQUZELGtEQUVDO0FBRUQsU0FBc0IsY0FBYyxDQUFDLEtBQW9CLEVBQUUsVUFBc0IsRUFBRSxLQUFhLEVBQUUsT0FBZSxFQUFFLFlBQW9CLEVBQUUsWUFBb0I7O1FBQ3pKLE1BQU0sV0FBVyxHQUFHLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFFBQVEsSUFBSSxVQUFVLElBQUksS0FBSyxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQ3BGLE1BQU0sUUFBUSxHQUFHLEdBQUcsWUFBWSxJQUFJLFlBQVksRUFBRSxDQUFDO1FBQ25ELE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLFdBQVcsSUFBSSxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBRTlELE1BQU0sTUFBTSxHQUFHO1lBQ1gsU0FBUyxFQUFFLDBCQUEwQjtZQUNyQyxHQUFHLEVBQUU7Z0JBQ0QsUUFBUSxFQUFFLFdBQVcsRUFBRSxjQUFjO2dCQUNyQyxRQUFRLEVBQUUsUUFBUSxDQUFDLHFCQUFxQjthQUMzQztTQUNKLENBQUM7UUFFRixJQUFJLENBQUM7WUFDRCxNQUFNLElBQUksR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7WUFDekQsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1FBQ2xELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLEtBQUssQ0FBQywrQkFBK0IsS0FBSyxFQUFFLENBQUMsQ0FBQztZQUN0RCxNQUFNLEtBQUssQ0FBQztRQUNoQixDQUFDO0lBQ0wsQ0FBQztDQUFBO0FBcEJELHdDQW9CQztBQUVELFNBQXNCLGdCQUFnQixDQUFDLEtBQW9CLEVBQUUsVUFBc0IsRUFBRSxLQUFhLEVBQUUsT0FBZSxFQUFFLFlBQW9CLEVBQUUsWUFBb0IsRUFBRSxJQUFTOztRQUN0SyxNQUFNLFdBQVcsR0FBRyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxRQUFRLElBQUksVUFBVSxJQUFJLEtBQUssSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUNwRixNQUFNLFFBQVEsR0FBRyxHQUFHLFlBQVksSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUVuRCxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDakUsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsUUFBUSxZQUFZLFdBQVcsSUFBSSxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBRXBGLE1BQU0sTUFBTSxHQUFHO1lBQ1gsU0FBUyxFQUFFLDBCQUEwQjtZQUNyQyxJQUFJLEVBQUU7Z0JBQ0YsUUFBUSxFQUFFLFdBQVcsRUFBRSxjQUFjO2dCQUNyQyxRQUFRLEVBQUUsUUFBUSxFQUFFLHFCQUFxQjtnQkFDekMsSUFBSSxFQUFFLElBQUk7YUFDYjtTQUNKLENBQUM7UUFFRixJQUFJLENBQUM7WUFDRCxNQUFNLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7UUFDaEQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLCtCQUErQixLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ3RELE1BQU0sS0FBSyxDQUFDO1FBQ2hCLENBQUM7SUFDTCxDQUFDO0NBQUE7QUF0QkQsNENBc0JDIn0=