"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUser = void 0;
function validateUser(req, res) {
    if (!req.query.email || typeof req.query.email !== 'string') {
        console.error(`Unauthorized: Email is required`);
        res.status(401).send('Unauthorized');
        return undefined;
    }
    let email = normalizeEmail(req.query.email);
    if (email.endsWith('@polyverse.com')) {
        console.error(`Unauthorized: Access restricted for polyverse.com domain`);
        res.status(401).send('Unauthorized');
        return undefined;
    }
    console.log(`User authorized: ${email}`);
    return email;
}
exports.validateUser = validateUser;
function normalizeEmail(email) {
    // if the domain of the email is polytest.ai then change it to polyverse.com
    // use a regex to replace the domain case insensitive
    email = email.toLowerCase();
    return email.replace(/@polytest\.ai$/i, '@polyverse.com');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9hdXRoLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLFNBQWdCLFlBQVksQ0FBQyxHQUFZLEVBQUUsR0FBYTtJQUNwRCxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLElBQUksT0FBTyxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUMxRCxPQUFPLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxDQUFDLENBQUM7UUFDakQsR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDckMsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztJQUVELElBQUksS0FBSyxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRTVDLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7UUFDbkMsT0FBTyxDQUFDLEtBQUssQ0FBQywwREFBMEQsQ0FBQyxDQUFDO1FBQzFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ3JDLE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7SUFFRCxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixLQUFLLEVBQUUsQ0FBQyxDQUFDO0lBRXpDLE9BQU8sS0FBSyxDQUFDO0FBQ2pCLENBQUM7QUFsQkQsb0NBa0JDO0FBRUQsU0FBUyxjQUFjLENBQUMsS0FBYTtJQUNqQyw0RUFBNEU7SUFDNUUscURBQXFEO0lBQ3JELEtBQUssR0FBRyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDNUIsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLGlCQUFpQixFQUFFLGdCQUFnQixDQUFDLENBQUM7QUFDOUQsQ0FBQyJ9