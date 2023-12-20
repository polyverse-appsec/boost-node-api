import { Request, Response } from 'express';

export function validateUser(req: Request, res: Response): string | undefined {
    if (!req.query.email || typeof req.query.email !== 'string') {
        console.error(`Unauthorized: Email is required`);
        res.status(401).send('Unauthorized');
        return undefined;
    }

    let email = normalizeEmail(req.query.email);

    if (!email.endsWith('@polyverse.com')) {
        console.error(`Unauthorized: Access restricted for polyverse.com domain`);
        res.status(401).send('Unauthorized');
        return undefined;
    }

    console.log(`User authorized: ${email}`);

    return email;
}

function normalizeEmail(email: string): string {
    // if the domain of the email is polytest.ai then change it to polyverse.com
    // use a regex to replace the domain case insensitive
    email = email.toLowerCase();
    return email.replace(/@polytest\.ai$/i, '@polyverse.com');
}
