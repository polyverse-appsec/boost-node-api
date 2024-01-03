import { Request, Response } from 'express';

import * as jwt from 'jsonwebtoken';

import { getSecret } from './secrets';

interface RawIdentity {
    email: string;
    expires: number;
}

export function validateUser(req: Request, res: Response): string | undefined {
    let email = '';
    // if the identity of the caller is signed, we need to verify AuthN
    //   - we'll get the signed identity blob (base-64 encoded JWT)
    //   - we'll get the signing key (base-64 encoded public key)
    //   - we'll get the signing algorithm (e.g. RS256)
    //   - we'll use the signing key and algorithm to verify the signature of the identity blob
    //   - we'll decode the identity blob to get the email address
    if (req.headers['x-signed-identity']) {
        let signingKey = process.env.JWT_SIGNING_KEY;
        if (!signingKey) {
            // get the key from the AWS Secrets Manager
            const secretData : any = getSecret('boost-sara');
            signingKey = secretData['sara-client-public-key'];
        }
        if (!signingKey) {
            console.error(`Unauthorized: Signing key is required`);
            res.status(401).send('Unauthorized');
            return undefined;
        }
        let signingAlgorithm = req.headers['x-signing-algorithm'] as jwt.Algorithm;
        if (!signingAlgorithm) {
            signingAlgorithm = 'RS256';
        }

        // extract the JWT from the identity blob
        const base64encodedIdentityJWT = req.headers['x-signed-identity'] as string;
        const identityJWT = Buffer.from(base64encodedIdentityJWT, 'base64').toString('utf-8');

        // verify the JWT signature
        const publicKey = Buffer.from(signingKey as string, 'base64').toString('utf-8');
        try {
            const identity = jwt.verify(identityJWT, publicKey, { algorithms: [signingAlgorithm] }) as RawIdentity;

            // check the expiration - to help avoid reuse attacks
            if (identity.expires && identity.expires < Date.now()) {
                console.error(`Unauthorized: Signed identity expired`);
                res.status(401).send('Unauthorized');
                return undefined;
            }

            email = normalizeEmail(identity.email);
        } catch (err) {
            console.error(`Unauthorized: Invalid signed identity`);
            res.status(401).send('Unauthorized');
            return undefined;
        }
    }

    // if no query param, then extract the X-User-Account from the header
    if (!email) {
        if (!req.headers['x-user-account']) {
            console.error(`Unauthorized: Email is required`);
            res.status(401).send('Unauthorized');
            return undefined;
        }
        // only support this header if we are running locally and not in AWS / Cloud
        if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
            console.error(`Unauthorized: Lambda function name is required`);
            res.status(401).send('Unauthorized');
            return undefined;
        }

        email = normalizeEmail(req.headers['x-user-account'] as string);
    }

    console.log(`User authenticated: ${email}`);

    return email;
}

function normalizeEmail(email: string): string {
    // if the domain of the email is polytest.ai then change it to polyverse.com
    // use a regex to replace the domain case insensitive
    email = email.toLowerCase();
    return email.replace(/@polytest\.ai$/i, '@polyverse.com');
}
