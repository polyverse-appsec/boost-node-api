import unittest
import requests
import json

from utils import get_signed_headers


class BoostBackendCheckinSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"
    HEADERS = {'x-user-account': EMAIL}

    def test_user_profile(self):
        print("Running test: Build User profile and verify")
        headers = get_signed_headers(self.EMAIL)

        response = requests.get(f"{self.BASE_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)

        profile = {
            "name": "Unit Tester",
            "title": "QA Engineer",
            "details": "I am a QA Engineer",
        }

        response = requests.put(f"{self.BASE_URL}/api/user/profile", json.dumps(profile), headers=headers)
        self.assertEqual(response.status_code, 200)
        puttedData = response.json()
        self.assertEqual(puttedData['name'], profile['name'])
        self.assertEqual(puttedData['title'], profile['title'])
        self.assertEqual(puttedData['details'], profile['details'])

        response = requests.get(f"{self.BASE_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)
        gettedData = response.json()
        self.assertEqual(gettedData['name'], profile['name'])
        self.assertEqual(gettedData['title'], profile['title'])
        self.assertEqual(gettedData['details'], profile['details'])

        response = requests.delete(f"{self.BASE_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{self.BASE_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)
        gettedData = response.json()
        self.assertFalse('name' in gettedData)
        self.assertFalse('title' in gettedData)
        self.assertFalse('details' in gettedData)
