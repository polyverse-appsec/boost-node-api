export function validateUser(req, res) {
    if (!req.query.email) {
        console.error(`Unauthorized: Email is required`);
        res.status(401).send('Unauthorized');
        return undefined;
    }

    email = normalizeEmail(req.query.email);

    if (email.endsWith('@polyverse.com')) {
        res.status(401).send('Unauthorized');
        return undefined;
    }

    console.log(`User authorized: ${email}`);

    return email;
}

function normalizeEmail(email) {
    // if the domain of the email is polytest.ai then change it to polyverse.com
    // use a regex to replace the domain case insensitive
    email = email.toLowerCase();
    return email.replace(/@polytest\.ai$/i, '@polyverse.com');
}