import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { getSingleSecret } from './secrets';
import { HTTP_FAILURE_UNAUTHORIZED } from './utility/dispatch';

export const header_X_Signed_Identity = 'X-Signed-Identity';
export const header_X_Signing_Algorithm = 'X-Signing-Algorithm';
export const local_sys_admin_email = "root@localhost";

interface RawIdentity {
    email: string;
    organization?: string;
    expires: number;
}

export enum AuthType {
    User,
    Admin
}

export async function validateUser(req: Request, res: Response, accessType: AuthType = AuthType.User): Promise<string | undefined> {
    let email = '';

    // if the identity of the caller is signed, we need to verify AuthN
    //   - we'll get the signed identity blob (base-64 encoded JWT)
    //   - we'll get the signing key (base-64 encoded public key)
    //   - we'll get the signing algorithm (e.g. RS256)
    //   - we'll use the signing key and algorithm to verify the signature of the identity blob
    //   - we'll decode the identity blob to get the email address

    // Try to extract the identity token from the Authorization header or X-Signed-Identity
    let identityJWT: string | undefined = getSignedIdentityFromHeader(req);

    if (identityJWT) {
        let signingKey = process.env.JWT_SIGNING_KEY || await getSingleSecret('boost-sara/sara-client-public-key');
        if (!signingKey) {
            console.error(`Unauthorized: Signing key is required`);
            res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
            return undefined;
        }

        const signedAlgorithmHeader = Object.keys(req.headers).find(key => key.toLowerCase() === header_X_Signing_Algorithm.toLowerCase());
        let signingAlgorithm = signedAlgorithmHeader ? req.headers[signedAlgorithmHeader] as jwt.Algorithm : 'RS256';

        // Verify the JWT signature directly
        try {
            const identity = jwt.verify(identityJWT, signingKey, { algorithms: [signingAlgorithm] }) as RawIdentity;
    
            // Check the expiration
            if (identity.expires && identity.expires < (Date.now() / 1000)) {
                console.error(`Unauthorized: Signed identity expired`);
                res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
                return undefined;
            }

            email = normalizeEmail(identity.email);
        } catch (err) {
            console.error(`Unauthorized: Invalid signed identity: ${err} - Identity Header: ${identityJWT}`);
            res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
            return undefined;
        }
    }

    // if no signed identity then extract the X-User-Account from the header
    if (!email) {
        const userAccountHeader = Object.keys(req.headers).find(key => key.toLowerCase() === 'x-user-account');
        if (!userAccountHeader || !req.headers[userAccountHeader]) {
            console.error(`Unauthorized: Email is required`);
            res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
            return undefined;
        }
        // only support this header if we are running locally and not in AWS / Cloud
        if (!process.env.ENABLE_UNSIGNED_AUTHN) {
            console.error(`Unauthorized: UNSIGNED_AUTHN is not enabled; set ENABLE_UNSIGNED_AUTHN=true to enable`);
            res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
            return undefined;
        } else {
            console.warn(`ENABLE_UNSIGNED_AUTHN is enabled; BUT MOST APIs will NOT work with this user authentication model, since most APIs use identity delegation`);
        }
        
        email = req.headers[userAccountHeader] as string;
    }

    // cleanup email so we always get the same email style for validation
    email = normalizeEmail(email);

    if (process.env.TRACE_LEVEL) {
        console.log(`User authenticated: ${email}`);
    }
    
    if (accessType === AuthType.Admin) {
        if (email !== local_sys_admin_email) {
            console.error(`Unauthorized: Admin access is required`);
            res.status(HTTP_FAILURE_UNAUTHORIZED).send('Unauthorized');
            return undefined;
        }
        console.log(`Admin access granted: ${email}`);
    }

    return email;
}

function normalizeEmail(email: string): string {
    // if the domain of the email is polytest.ai then change it to polyverse.com
    // use a regex to replace the domain case insensitive
    email = email.toLowerCase();
    return email.replace(/@polytest\.ai$/i, '@polyverse.com');
}

export async function signedAuthHeader(email: string, organization?: string): Promise<{ [key: string]: string }> {
    let signingKey = process.env.JWT_SIGNING_KEY || await getSingleSecret('boost-sara/sara-client-private-key');
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

    const signedToken = jwt.sign(unsignedIdentity, signingKey, { algorithm: 'RS256' });
    return { [header_X_Signed_Identity]: signedToken };
}

export function getSignedIdentityFromHeader(req: Request): string | undefined {
    const bearerToken = extractBearerToken(req);
    if (bearerToken) {
        return bearerToken;
    }
    const signedIdentityHeader = Object.keys(req.headers).find(key => key.toLowerCase() === header_X_Signed_Identity.toLowerCase());
    return signedIdentityHeader ? req.headers[signedIdentityHeader] as string : undefined;
}

function extractBearerToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    return undefined;
}
