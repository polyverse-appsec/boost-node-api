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
exports.storeProjectData = exports.getProjectData = exports.convertToSourceType = exports.SourceType = void 0;
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const dynamoDB = new aws_sdk_1.default.DynamoDB.DocumentClient();
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
        const data = yield dynamoDB.get(params).promise();
        if (!data.Item || !data.Item.data) {
            return undefined;
        }
        return data.Item.data;
    });
}
exports.getProjectData = getProjectData;
function storeProjectData(email, sourceType, owner, project, resourcePath, analysisType, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const projectPath = `${email ? email : "public"}/${sourceType}/${owner}/${project}`;
        const dataPath = `${resourcePath}/${analysisType}`;
        const dataSize = Buffer.byteLength(data, 'utf8');
        console.log(`storeProjectData for (${dataSize} bytes): ${projectPath}/${dataPath}`);
        const params = {
            TableName: analysisDatastoreTableName,
            Item: {
                tableKey: projectPath, // primary key
                dataPath: dataPath, // secondary/sort key
                data: data
            }
        };
        yield dynamoDB.put(params).promise();
    });
}
exports.storeProjectData = storeProjectData;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zdG9yYWdlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7OztBQUFBLHNEQUEwQjtBQUUxQixNQUFNLFFBQVEsR0FBRyxJQUFJLGlCQUFHLENBQUMsUUFBUSxDQUFDLGNBQWMsRUFBRSxDQUFDO0FBRW5ELE1BQU0sMEJBQTBCLEdBQUcseUJBQXlCLENBQUM7QUFFN0QsSUFBWSxVQUdYO0FBSEQsV0FBWSxVQUFVO0lBQ2xCLCtCQUFpQixDQUFBO0lBQ2pCLDhCQUFnQixDQUFBO0FBQ3BCLENBQUMsRUFIVyxVQUFVLDBCQUFWLFVBQVUsUUFHckI7QUFFRCwyQ0FBMkM7QUFDM0MsU0FBZ0IsbUJBQW1CLENBQUMsTUFBYztJQUM5QyxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUM7QUFDekYsQ0FBQztBQUZELGtEQUVDO0FBRUQsU0FBc0IsY0FBYyxDQUFDLEtBQW9CLEVBQUUsVUFBc0IsRUFBRSxLQUFhLEVBQUUsT0FBZSxFQUFFLFlBQW9CLEVBQUUsWUFBb0I7O1FBQ3pKLE1BQU0sV0FBVyxHQUFHLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFFBQVEsSUFBSSxVQUFVLElBQUksS0FBSyxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQ3BGLE1BQU0sUUFBUSxHQUFHLEdBQUcsWUFBWSxJQUFJLFlBQVksRUFBRSxDQUFDO1FBQ25ELE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLFdBQVcsSUFBSSxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBRTlELE1BQU0sTUFBTSxHQUE2QztZQUNyRCxTQUFTLEVBQUUsMEJBQTBCO1lBQ3JDLEdBQUcsRUFBRTtnQkFDRCxRQUFRLEVBQUUsV0FBVyxFQUFFLGNBQWM7Z0JBQ3JDLFFBQVEsRUFBRSxRQUFRLENBQUMscUJBQXFCO2FBQzNDO1NBQ0osQ0FBQztRQUVGLE1BQU0sSUFBSSxHQUFHLE1BQU0sUUFBUSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUVsRCxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDaEMsT0FBTyxTQUFTLENBQUM7UUFDckIsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDMUIsQ0FBQztDQUFBO0FBcEJELHdDQW9CQztBQUVELFNBQXNCLGdCQUFnQixDQUFDLEtBQW9CLEVBQUUsVUFBc0IsRUFBRSxLQUFhLEVBQUUsT0FBZSxFQUFFLFlBQW9CLEVBQUUsWUFBb0IsRUFBRSxJQUFTOztRQUN0SyxNQUFNLFdBQVcsR0FBRyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxRQUFRLElBQUksVUFBVSxJQUFJLEtBQUssSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUNwRixNQUFNLFFBQVEsR0FBRyxHQUFHLFlBQVksSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUVuRCxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztRQUVqRCxPQUFPLENBQUMsR0FBRyxDQUFDLHlCQUF5QixRQUFRLFlBQVksV0FBVyxJQUFJLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFFcEYsTUFBTSxNQUFNLEdBQTZDO1lBQ3JELFNBQVMsRUFBRSwwQkFBMEI7WUFDckMsSUFBSSxFQUFFO2dCQUNGLFFBQVEsRUFBRSxXQUFXLEVBQUUsY0FBYztnQkFDckMsUUFBUSxFQUFFLFFBQVEsRUFBRSxxQkFBcUI7Z0JBQ3pDLElBQUksRUFBRSxJQUFJO2FBQ2I7U0FDSixDQUFDO1FBRUYsTUFBTSxRQUFRLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQ3pDLENBQUM7Q0FBQTtBQWxCRCw0Q0FrQkMifQ==