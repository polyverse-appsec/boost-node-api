import unittest
import requests

from utils import get_signed_headers


class BadInputServiceSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"

    def test_no_content_type_project_post(self):
        print("Running test: No Content-Type header on project POST")
        headers = get_signed_headers(self.EMAIL)

        data = {
            'resources': [{'uri': "https://github.com/public-apis/public-apis/"}]
        }
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", data=data, headers=headers)
        self.assertEqual(response.text, "Invalid JSON")
        self.assertEqual(response.status_code, 400)

    def test_user_profile_no_input(self):
        print("Running test: user profile put no data")
        headers = get_signed_headers(self.EMAIL)

        response = requests.put(f"{self.BASE_URL}/api/user/profile", None, headers=headers)
        self.assertEqual(response.status_code, 400)
