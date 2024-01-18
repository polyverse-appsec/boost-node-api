import { Request, Response } from 'express';

import * as jwt from 'jsonwebtoken';

import { getSingleSecret } from './secrets';

interface RawIdentity {
    email: string;
    organization?: string;
    expires: number;
}

export async function validateUser(req: Request, res: Response): Promise<string | undefined> {
    let email = '';
    // if the identity of the caller is signed, we need to verify AuthN
    //   - we'll get the signed identity blob (base-64 encoded JWT)
    //   - we'll get the signing key (base-64 encoded public key)
    //   - we'll get the signing algorithm (e.g. RS256)
    //   - we'll use the signing key and algorithm to verify the signature of the identity blob
    //   - we'll decode the identity blob to get the email address

    // we need to look for any cased variant of x-signed-identity in the header
    const signedIdentityHeader = Object.keys(req.headers).find(key => key.toLowerCase() === 'x-signed-identity');
    if (signedIdentityHeader) {
        let signingKey = process.env.JWT_SIGNING_KEY;
        if (!signingKey) {
            signingKey = await getSingleSecret('boost-sara/sara-client-public-key');
        }
        if (!signingKey) {
            console.error(`Unauthorized: Signing key is required`);
            res.status(401).send('Unauthorized');
            return undefined;
        }
    
        const signedAlgorithmHeader = Object.keys(req.headers).find(key => key.toLowerCase() === 'x-signing-algorithm');
        let signingAlgorithm = signedAlgorithmHeader?req.headers[signedAlgorithmHeader] as jwt.Algorithm:undefined;
        if (!signingAlgorithm) {
            signingAlgorithm = 'RS256';
        }
    
        // Extract the JWT from the identity blob
        const identityJWT = req.headers[signedIdentityHeader] as string;

        // Verify the JWT signature directly
        try {
            const identity = jwt.verify(identityJWT, signingKey, { algorithms: [signingAlgorithm] }) as RawIdentity;
    
            // Check the expiration
            if (identity.expires && identity.expires < (Date.now() / 1000)) {
                console.error(`Unauthorized: Signed identity expired`);
                res.status(401).send('Unauthorized');
                return undefined;
            }

            email = normalizeEmail(identity.email);
        } catch (err) {
            console.error(`Unauthorized: Invalid signed identity: ${err} - Identity Header: ${identityJWT}`);
            res.status(401).send('Unauthorized');
            return undefined;
        }
    }

    // if no signed identity then extract the X-User-Account from the header
    if (!email) {
        const userAccountHeader = Object.keys(req.headers).find(key => key.toLowerCase() === 'x-user-account');
        if (!userAccountHeader || !req.headers[userAccountHeader]) {
            console.error(`Unauthorized: Email is required`);
            res.status(401).send('Unauthorized');
            return undefined;
        }
        // only support this header if we are running locally and not in AWS / Cloud
        if (!process.env.ENABLE_UNSIGNED_AUTHN) {
            console.error(`Unauthorized: UNSIGNED_AUTHN is not enabled; set ENABLE_UNSIGNED_AUTHN=true to enable`);
            res.status(401).send('Unauthorized');
            return undefined;
        }

        email = normalizeEmail(req.headers[userAccountHeader] as string);
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

export async function signedAuthHeader(email: string, organization?: string): Promise<{'X-Signed-Identity': string}> {
    let signingKey = process.env.JWT_SIGNING_KEY;
    if (!signingKey) {
        signingKey = await getSingleSecret('boost-sara/sara-client-private-key');
    }
    if (!signingKey) {
        throw new Error(`Signing key is required`);
    }

    const unsignedIdentity : RawIdentity = {
        email: email,
        expires: Math.floor(Date.now() / 1000) + 60  // auth expires in 1 minute
    };
    // only include organization if provided - e.g. to talk to backend AI Boost Service
    if (organization) {
        unsignedIdentity.organization = organization;
    }

    // if the domain of the email is polyverse.com then change it to polytest.ai
    // use a regex to replace the domain case insensitive
    const signedToken = jwt.sign(unsignedIdentity, signingKey, { algorithm: 'RS256' });
    return { 'X-Signed-Identity': signedToken}
}

export function getSignedIdentityFromHeader(req: Request): string | undefined {
    // we need to look for any cased variant of x-signed-identity in the header
    const signedIdentityHeader = Object.keys(req.headers).find(key => key.toLowerCase() === 'x-signed-identity');
    if (!signedIdentityHeader) {
        return undefined;
    }

    // Extract the JWT from the identity blob
    const identityJWT = req.headers[signedIdentityHeader] as string;

    return identityJWT;
}