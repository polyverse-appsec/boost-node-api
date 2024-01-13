import unittest
import requests

from utils import get_signed_headers


class BoostBackendCheckinSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"
    HEADERS = {'x-user-account': EMAIL}

    def test_strong_authn(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(self.EMAIL)

        data = {"resources": ["resource1", "resource2"]}
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
