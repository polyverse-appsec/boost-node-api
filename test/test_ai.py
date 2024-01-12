import unittest
import requests

from utils import get_signed_headers


class BoostBackendAIServiceSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"
    ORG = "polytest"
    HEADERS = {'x-user-account': EMAIL}

    def test_customer_portal(self):
        print("Running test: Customer Account status")

        signedHeaders = get_signed_headers(self.EMAIL)

        response = requests.get(f"{self.BASE_URL}/api/proxy/ai/${self.ORG}/customer_portal", None, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        responseJson = response.json()
        self.assertTrue(responseJson["enabled"])
