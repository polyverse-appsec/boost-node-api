enum Services {
    QuickBlueprint = 'quick-blueprint',
    DraftBlueprint = 'draft-blueprint',

    Summarizer = 'summarizer',

    CustomerPortal = 'customer_portal',
}

class Endpoints {
    private static map: Map<Services, string> = new Map<Services, string>([
        [Services.QuickBlueprint, 'https://vryv4jotc6rghitxmwaz5whrqm0obehc.lambda-url.us-west-2.on.aws/'],
        [Services.DraftBlueprint, 'https://7qpij3jplvcmdaojfumgj32e7e0vcchc.lambda-url.us-west-2.on.aws/'],

        [Services.CustomerPortal, 'https://roxbi254sch3yijt7tqbz4s7jq0jxddr.lambda-url.us-west-2.on.aws/'],

        [Services.Summarizer, 'https://j4sijrqerxrjonxbq27hg37xte0qghrt.lambda-url.us-west-2.on.aws/'],
    ]);

    static get(service: Services): string {
        if (this.map.has(service)) {
            return this.map.get(service) as string;
        } else {
            throw new Error(`No endpoint found for service ${service}`);
        }
    }
}