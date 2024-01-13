import unittest
import requests

from utils import get_signed_headers


class BoostBackendAIServiceSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"
    HEADERS = {'x-user-account': EMAIL}

    def test_no_content_type_project_post(self):
        print("Running test: No Content-Type header on project POST")
        no_type_headers = {
            'x-user-account': self.EMAIL
        }
        data = {
            'resources': [{'uri': "https://github.com/public-apis/public-apis/"}]
        }
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", data=data, headers=no_type_headers)
        self.assertEqual(response.text, "Invalid JSON")
        self.assertEqual(response.status_code, 400)