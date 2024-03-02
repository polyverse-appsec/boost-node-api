import unittest
import requests
import time
import json

from utils import get_signed_headers

from constants import TARGET_URL, EMAIL, ORG, PUBLIC_PROJECT_NAME, PREMIUM_EMAIL, PRIVATE_PROJECT_NAME, PUBLIC_PROJECT, PRIVATE_PROJECT


class End2EndTestSuite(unittest.TestCase):

    def test_task_generator_launch_blueprint_public(self):
        self.helper_task_generator_launch("blueprint", False)

    def test_task_generator_launch_projectsource_public(self):
        self.helper_task_generator_launch("projectsource", False)

    def test_task_generator_launch_aispec_public(self):
        self.helper_task_generator_launch("aispec", False)

    def test_task_generator_launch_blueprint_private(self):
        self.helper_task_generator_launch("blueprint", True)

    def test_task_generator_launch_projectsource_private(self):
        self.helper_task_generator_launch("projectsource", True)

    def test_task_generator_launch_aispec_private(self):
        self.helper_task_generator_launch("aispec", True)

    def helper_task_generator_launch(self, resource_type, private):
        print(f"Running test: launch a generator for a {resource_type} resource")

        headers = get_signed_headers(EMAIL if not private else PREMIUM_EMAIL)

        project_name = PUBLIC_PROJECT_NAME if not private else PRIVATE_PROJECT_NAME

        # cleanup resources
        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=headers)
        if response.status_code == 200:
            response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", headers=headers)
            self.assertTrue(response.status_code == 200 or response.status_code == 404)

        # create a sample project to test with
        data = {"resources": [{"uri": PUBLIC_PROJECT if not private else PRIVATE_PROJECT}]}
        response = requests.put(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}", json=data, headers=headers)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource_type}/generator", headers=headers)
        self.assertEqual(response.status_code, 200)
        response = response.json() if 'body' not in response.json() else json.loads(response.json()['body'])
        if response['status'] != "idle":
            print("Generator is not idle, so test results may be compromised - continuing anyway")

            # try to idle the task generator
            response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource_type}/generator", json={"status": "idle"}, headers=headers)
            self.assertEqual(response.status_code, 200)
            response = response.json() if 'body' not in response.json() else json.loads(response.json()['body'])
            self.assertEqual(response["status"], "idle")

            # check the generator state to make sure its idle
            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource_type}/generator", headers=headers)
            self.assertEqual(response.status_code, 200)
            response = response.json() if 'body' not in response.json() else json.loads(response.json()['body'])
            self.assertEqual(response["status"], "idle")

        # start the task generator
        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource_type}/generator", json={"status": "processing"}, headers=headers)
        self.assertTrue(response.status_code == 202 or response.status_code == 200)
        self.assertTrue(response.json()["status"] == "processing" or response.json()["status"] == "idle")

        # we need to make sure the resource is generated immediately - even if further updates will happen
        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource_type}", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.text if 'body' not in response.json() else response.json()['body']
        self.assertIsNotNone(data)

        # we'll loop until the generator is idle or in an error state - for 30 seconds max
        #       every second, we'll do a GET and check its state
        #       if it's idle, we'll break out of the loop and pass the test
        #       if it's in an error state, we'll break out of the loop and fail the test
        #       if it's still processing, we'll continue looping
        #       each loop, we'll print the current generator state
        # for i in range(48):
        i = 0
        while True:
            i += 1
            print(f"Checking {resource_type} Resource/Generator #{i}")

            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource_type}/generator", headers=headers)
            self.assertEqual(response.status_code, 200)
            response = response.json() if 'body' not in response.json() else json.loads(response.json()['body'])
            self.assertIn(response["status"], ["idle", "processing", "error"])

            print(f"Check {i}:\n\t{response}")

            # if the generator is idle or an error, we'll exit the loop
            # otherwise, keep 'processing'
            if response["status"] == "idle":
                break
            if response["status"] == "error":
                break

            # make sure the blueprint resource is still available
            response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource_type}", headers=headers)
            self.assertEqual(response.status_code, 200)
            data = response.text if 'body' not in response.json() else response.json()['body']
            self.assertIsNotNone(data)

            # wait a couple seconds before re-sampling
            time.sleep(5)
        self.assertEqual(response["status"], "idle")

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/{resource_type}", headers=headers)
        self.assertEqual(response.status_code, 200)
        data = response.text if 'body' not in response.json() else response.json()['body']
        self.assertIsNotNone(data)
