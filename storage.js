const analysisDatastoreTableName = 'Boost.AnalysisDataStore';
const tableKey = 'projectPath';
const dataPath = 'dataPath';

export const SourceType = {
    GitHub: 'github',
    General: 'blob'
}

source, owner, project, decodedPath, analysisType

export async function getProjectData(email, sourceType, owner, project, resourcePath, analysisType) {
    const projectPath = `${email?email:"public"}/${sourceType}/${owner}/${project}`;
    const dataPath = `${resourcePath}/${analysisType}`;
    console.log(`getProjectData for: ${projectPath}/${dataPath}`);

    const params = {
        TableName: analysisDatastoreTableName,
        Key: {
            tableKey: projectPath, // primary key
            dataPath: dataPath // secondary/sort key
        }
    };

    const data = await dynamoDB.get(params).promise();

    if (!data?.Item?.data) {
        return undefined;
    }

    return data.Item.data;
}

export async function storeProjectData(email, sourceType, owner, project, resourcePath, analysisType, data) {
    const projectPath = `${email?email:"public"}/${sourceType}/${owner}/${project}`;
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

    await dynamoDB.put(params).promise();
}