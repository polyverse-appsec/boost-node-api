LOCAL_URL = "http://localhost:3000"  # Local Test Server
CLOUD_URL_LEGACY = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Legacy - no longer maintained/compatible

CLOUD_URL_DEV = "https://e22ksqihwjm3chxizytehhluee0jckbd.lambda-url.us-west-2.on.aws"
CLOUD_URL_TEST = "https://sztg3725fqtcptfts5vrvcozoe0nxcew.lambda-url.us-west-2.on.aws"
CLOUD_URL_PROD = "https://33pdosoitl22c42c7sf46tabi40qwlae.lambda-url.us-west-2.on.aws"

TARGET_URL = LOCAL_URL  # CLOUD_URL_DEV  # LOCAL_URL

all_stages = {
    "dev": CLOUD_URL_DEV,
    "test": CLOUD_URL_TEST,
    "prod": CLOUD_URL_PROD,
    "local": LOCAL_URL
}

EMAIL = "unittest@polytest.ai"
MONITOR_EMAIL = "monitor@polytest.ai"
PREMIUM_EMAIL = "stephen@polyverse.com"
BASIC_EMAIL = "unittest@polyverse-test.com"
BASIC_EMAIL_WITH_GITHUB_APP = "Sara.polyverse.test@gmail.com"
ORG = "polyverse-test-org"

LOCAL_ADMIN_EMAIL = "root@localhost"

AARON_EMAIL = "aaron@polyverse.com"

FREE_EMAIL = "unittest@free-polyverse.com"
FREE_ORG = "free-polyverse-test-org"

FREE_PROJECT_NAME = "free-test-project"

TEST_ORG = "org123"
TEST_PROJECT_NAME = "project456"

# PRIVATE_PROJECT = "https://github.com/StephenAFisher/testRepoForBoostGitHubApp"
PRIVATE_PROJECT = "https://github.com/polyverse-appsec/sara"
PRIVATE_PROJECT_NAME = "test-sara"

PRIVATE_PROJECT_NAME_CHECKIN_TEST = "checkin_test_private_repo"

# PRIVATE_PROJECT = "https://github.com/polyverse-appsec/boostlambda"
PUBLIC_PROJECT = "https://github.com/public-apis/public-apis"
PUBLIC_PROJECT_NAME = "github-public-apis"
PUBLIC_PROJECT_NAME_CHECKIN_TEST = "checkin_test_public_repo"

PRIVATE_PROJECT_LARGE_NAME = "test-sara-large"
PRIVATE_PROJECT_LARGE = "https://github.com/polyverse-appsec/polyx"

PRIVATE_PROJECT_NAME_CUSTOM_NFTMINT = "test-sara-nftmint"
PRIVATE_PROJECT_CUSTOM_NFTMINT = "https://github.com/polyverse-appsec/NFT-Mint"

PRIVATE_PROJECT_MEDIUM = "https://github.com/polyverse-appsec/EXM_DP_BizRules"
