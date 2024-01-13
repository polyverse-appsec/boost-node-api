import unittest
import requests
import json
import time

from utils import get_signed_headers


class End2EndTestSuite(unittest.TestCase):
    BASE_URL = "http://localhost:3000"  # Local Test Server
    CLOUD_URL = "https://pt5sl5vwfjn6lsr2k6szuvfhnq0vaxhl.lambda-url.us-west-2.on.aws"  # AWS Lambda URL
    EMAIL = "unittest@polytest.ai"

    def test_task_generator_launch(self):
        print("Running test: launch a generator")

        headers = get_signed_headers(self.EMAIL)

        # create a sample project to test with
        data = {"resources": [{"uri": "http://www.github.com/public-apis/public-apis"}]}
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456", json=data, headers=headers)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", headers=headers)
        self.assertEqual(response.status_code, 200)
        if response.json()['status'] != "idle":
            print("Generator is not idle, so test results may be compromised - continuing anyway")

            # try to idle the task generator
            response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", json={"status": "processing"}, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "idle")

            # check the generator state to make sure its idle
            response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "idle")

        # start the task generator
        response = requests.post(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", json={"status": "processing"}, headers=headers)
        self.assertTrue(response.status_code == 202 or response.status_code == 200)
        self.assertTrue(response.json()["status"] == "processing" or response.json()["status"] == "idle")

        # we'll loop until the generator is idle or in an error state - for 30 seconds max
        #       every second, we'll do a GET and check its state
        #       if it's idle, we'll break out of the loop and pass the test
        #       if it's in an error state, we'll break out of the loop and fail the test
        #       if it's still processing, we'll continue looping
        #       each loop, we'll print the current generator state
        for i in range(15):
            response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint/generator", headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertIn(response.json()["status"], ["idle", "processing", "error"])
            print(f"Check {i}:\n\t{response.json()}")
            if response.json()["status"] == "idle":
                break
            if response.json()["status"] == "error":
                break
            time.sleep(2)
        self.assertEqual(response.json()["status"], "idle")

        response = requests.get(f"{self.BASE_URL}/api/user_project/org123/project456/data/blueprint", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.text
        self.assertIsNotNone(data)

    def test_user_profile(self):
        print("Running test: Build User profile and verify")
        headers = get_signed_headers(self.EMAIL)

        response = requests.get(f"{self.BASE_URL}/api/user/profile", None, headers=headers)
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

        response = requests.get(f"{self.BASE_URL}/api/user/profile", None, headers=headers)
        self.assertEqual(response.status_code, 200)
        gettedData = response.json()
        self.assertEqual(gettedData['name'], profile['name'])
        self.assertEqual(gettedData['title'], profile['title'])
        self.assertEqual(gettedData['details'], profile['details'])

        response = requests.delete(f"{self.BASE_URL}/api/user/profile", headers=headers)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{self.BASE_URL}/api/user/profile", None, headers=headers)
        self.assertEqual(response.status_code, 200)
        gettedData = response.json()
        self.assertFalse('name' in gettedData)
        self.assertFalse('title' in gettedData)
        self.assertFalse('details' in gettedData)
