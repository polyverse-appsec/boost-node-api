import { PolyverseSupportEmail, sendHtmlEmail } from "./utility/email";
import { usFormatter } from "./utility/log";


const saraImageUrl = "https://boost.polyverse.com/_next/image?url=%2F_next%2Fstatic%2Fmedia%2FSara_Cartoon_Portrait.80bf5621.png&w=256&q=75";
const saraUrl = "https://boost.polyverse.com/";

const polyveseImageUrl = "https://boost.polyverse.com/_next/image?url=%2F_next%2Fstatic%2Fmedia%2FPolyverse%20logo%20medium.0b932d85.jpg&w=640&q=75"
const polyverseUrl = "https://www.polyverse.com"

export async function sendWelcomeEmail(accountEmail: string) {

    const subject = `Sara the AI Architect is ready to partner with you on your software projects!`;
    const htmlBody = `
        <html>
            <body>
                <p>Congratulations on signing into the Sara AI Architect service, by <a href="http://www.polyverse.com">Polyverse</a></p>
                <a href="${polyverseUrl}"><img src="${saraImageUrl}" alt="Sara AI Architect" /></a>
                <p><a href="${saraUrl}">${saraUrl}</a></p>
                <p></p>
                <p>Sara is excited to help boost your productivity in all facets of the software engineering lifecycle.</p>
                <p>Sara has a wide range of capabilities to help you with your software projects, including:</p>
                <ul>
                    <li>✅ Project creation to analyze GitHub repositories</li>
                    <li>✅ Project Goals can be set to guide Sara analysis</li>
                    <li>✅ Sara generated Class, Flow &amp; Architecture Diagrams for your code</li>
                    <li>✅ Sara generated Task-plans to achieve your Goals</li>
                    <li>✅ Ability to Analyze Any Public GitHub project</li>
                    <li>✅ Access to Analyze Private Source Repos</li>
                    <li>✅ Manual GitHub source synchronization</li>
                    <li>✅ Unlimited Project creation</li>
                    <li>✅ User Data never used outside your Organization</li>
                    <li>✅ Priority Customer Support</li>
                </ul>
                <p></p>
                <p>To get started with Sara, there are a few critical steps to follow:</p>
                <ol>
                    <li>1) Setup your Billing Organization - either Personal or a Professional Business Organization</li>
                    <li>2) Setup your Monthly Premium Subscription Plan - enabling Project Creation and immediate source and analysis access</li>
                    <li>3) Install the <a href="https://github.com/apps/polyverse-boost">Boost GitHub App</a> to enable Sara to analyze GitHub.com repositories on your behalf.</li>
                    <li>(Optional) 4) If you are an administrator for any of your organization's GitHub.com repositories, you must also install the <a href="https://github.com/apps/polyverse-boost">Boost GitHub App</a> for your organization to enable Sara to analyze all of your organization's private repositories.</li>
                <p></p>
                <p>When you are done with the above steps, Sara will be ready to help you with your software projects.</p>
                <p>You can always check your current Account, Subscription, Billing and App status by visiting <a href="${saraUrl}settings">your Settings page</a>.</p>
                <p></p>
                <p>Please let us know if you have any questions or need assistance by contacting <a href="mailto:support@polyverse.com">support@polyverse.com</a>.</p>
                <p>Thank you for using Sara with Boost AI by Polyverse and Happy Coding from the Polyverse team!</p>
                <a href="${polyverseUrl}"><img src="${polyveseImageUrl}" alt="Polyverse"/></a>
            </body>
        </html>
    `;
    const plainTextBody =
        `Congratulations on signing into the Sara AI Architect service, by Polyverse
        ${saraUrl}

        Sara is excited to help boost your productivity in all facets of the software engineering lifecycle.
        Sara has a wide range of capabilities to help you with your software projects, including:
        - Project creation to analyze GitHub repositories
        - Project Goals can be set to guide Sara analysis
        - Sara generated Class, Flow & Architecture Diagrams for your code
        - Sara generated Task-plans to achieve your Goals
        - Ability to Analyze Any Public GitHub project
        - Access to Analyze Private Source Repos
        - Manual GitHub source synchronization
        - Unlimited Project creation
        - User Data never used outside your Organization
        - Priority Customer Support

        To get started with Sara, there are a few critical steps to follow:
        1) Setup your Billing Organization - either Personal or a Professional Business Organization
        2) Setup your Monthly Premium Subscription Plan - enabling Project Creation and immediate source and analysis access
        3) Install the Boost GitHub App to enable Sara to analyze GitHub.com repositories on your behalf.
        (Optional) 4) If you are an administrator for any of your organization's GitHub.com repositories, you must also install the Boost GitHub App for your organization to enable Sara to analyze all of your organization's private repositories.

        When you are done with the above steps, Sara will be ready to help you with your software projects.
        You can always check your current Account, Subscription, Billing and App status by visiting your Settings page.

        Please let us know if you have any questions or need assistance by contacting support@polyverse.com
        Thank you for using Sara with Boost AI by Polyverse and Happy Coding from the Polyverse team!
        ${polyverseUrl}`;

    // Send a welcome email to the user
    await sendHtmlEmail(subject, htmlBody, plainTextBody, accountEmail, PolyverseSupportEmail);
}