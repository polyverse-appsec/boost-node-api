import { Request, Response } from 'express';

export async function store_vectordata_for_project(uri: URL, vectorData: string, req: Request, res: Response) {

    if (!vectorData) {
        res.status(400).send('Invalid vector data');
        throw new Error('Invalid vector data');
    }

    // return a list of assistant file resource id
    const assistantFileResourceIds = [];

    // add a single faux id for now - until we call the OpenAI assistant file creation api
    assistantFileResourceIds.push(0);

    // send result as a JSON string in the body
    res.header('Content-Type', 'application/json');
    res.send(JSON.stringify(assistantFileResourceIds));
}