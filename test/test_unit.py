import unittest
import requests
import datetime
import json

from utils import get_signed_headers

from constants import (
    TARGET_URL, EMAIL, ORG, PUBLIC_PROJECT, PUBLIC_PROJECT_NAME,
    PREMIUM_EMAIL, PRIVATE_PROJECT_NAME_CHECKIN_TEST, LOCAL_ADMIN_EMAIL,
    AARON_EMAIL, PRIVATE_PROJECT_CUSTOM_NFTMINT, PRIVATE_PROJECT_NAME_CUSTOM_NFTMINT
)


class UnitTestSuite(unittest.TestCase):

    def test_strong_authn(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(EMAIL, True)

        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/account", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_strong_authn_bearer_token(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(EMAIL, True, True)

        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/account", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_strong_authn_bearer_token_missing(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(EMAIL, True, True)
        # remove everything after Bearer to test broken token
        signedHeaders['Authorization'] = signedHeaders['Authorization'].split(' ')[0]

        response = requests.get(f"{TARGET_URL}/api/user/{ORG}/account", headers=signedHeaders)
        self.assertEqual(response.status_code, 401)

    def test_weak_authn(self):
        print("Running test: Weak authentication")

        # this is disabled by default

        unsignedHeader = {'x-user-account': EMAIL}

        response = requests.get(f"{TARGET_URL}/api/user/profile", headers=unsignedHeader)
        self.assertEqual(response.status_code, 401)

    def test_user_account(self):
        print("Running test: Strong authentication")

        signedHeaders = get_signed_headers(EMAIL)

        response = requests.get(f"{TARGET_URL}/api/user/org123/account", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        account = response.json()
        self.assertTrue(account["enabled"])

    def test_create_basic_project(self):
        print("Running test: Create basic user project")
        data = {"resources": [{"uri": PUBLIC_PROJECT}]}
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.post(f"{TARGET_URL}/api/user_project/org123/project456", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user_project/org123/project456", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        responseData = response.json()
        self.assertEqual(responseData['name'], "project456")
        self.assertNotEqual(len(responseData['resources']), 0)

    def test_project_status(self):
        print("Running test: Get Status of Private Project")
        signedHeaders = get_signed_headers(AARON_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user_project/polyverse-appsec/sara/status", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        responseData = response.json()
        self.assertIsNotNone(responseData)

    def test_create_empty_project(self):
        print("Running test: Retrieve data from the user's project")

        signedHeaders = get_signed_headers(EMAIL)
        response = requests.post(f"{TARGET_URL}/api/user_project/org123/project456", json={}, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user_project/org123/project456", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        responseData = response.json()
        self.assertEqual(responseData['name'], "project456")
        self.assertEqual(len(responseData['resources']), 0)

    def test_search_for_projects(self):
        print("Running test: Retrieve data from the user's project")

        signedHeaders = get_signed_headers(EMAIL)
        response = requests.post(f"{TARGET_URL}/api/user_project/org123/project456", json={}, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        signedHeaders = get_signed_headers(LOCAL_ADMIN_EMAIL)
        response = requests.get(f"{TARGET_URL}/api/search/projects?user=*&project=*&org=*", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        responseData = response.json()
        self.assertGreaterEqual(len(responseData), 1)

    def test_store_goals_data_in_project(self):
        print("Running test: Store goals data in the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        data = {"goals": "goal value"}
        response = requests.post(f"{TARGET_URL}/api/user_project/org123/project456/goals", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_retrieve_goals_data_from_project(self):
        print("Running test: Retrieve goals data from the user's project")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/user_project/org123/project456/goals", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"goals": "goal value"})

    def test_retrieve_sara_project_data_references(self):
        print("Running test: Retrieve goals data from the user's project")
        signedHeaders = get_signed_headers('aaron@polyverse.com')
        response = requests.get(f"{TARGET_URL}/api/user_project/polyverse-appsec/sara/data_references", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        data_references = response.json()
        self.assertIsNotNone(data_references)
        self.assertIsNotNone(len(data_references) > 0)

    def test_update_project(self):
        print("Running test: Updating project data")
        signedHeaders = get_signed_headers(EMAIL)
        data = {"resources": [{"uri": PUBLIC_PROJECT}]}
        response = requests.patch(f"{TARGET_URL}/api/user_project/org123/project456", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

    def test_api_version(self):
        print("Running test: check version of service")
        signedHeaders = get_signed_headers(EMAIL)
        response = requests.get(f"{TARGET_URL}/api/status", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.json()['version'], None)
        self.assertEqual(response.json()['type'], 'dev')
        self.assertEqual(response.json()['status'], 'available')

    def test_check_resource_status(self):
        print("Running test: Store data in the user's project")
        data = {"resources": [{"uri": PUBLIC_PROJECT}]}
        signedHeaders = get_signed_headers(EMAIL)

        # get current time in seconds / unix time
        now = datetime.datetime.now()
        unixtime = int(now.timestamp())

        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}-test", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}-test/data/blueprint", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.text, None)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{PUBLIC_PROJECT_NAME}-test/data/blueprint/status", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.json()['lastUpdated'], None)
        self.assertGreater(response.json()['lastUpdated'], unixtime)

    def test_generator_resource_projectsource_stage_filescan(self):
        print("Running test: Generator Resource ProjectSource Stage Filescan")

        project_name = PRIVATE_PROJECT_NAME_CHECKIN_TEST

        data = {"stage": 'File Paths Scan'}
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)

        # response = requests.post(f"{TARGET_URL}/test", json=data, headers=signedHeaders)
        # self.assertEqual(response.status_code, 200)

        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/projectsource/generator/process", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        # if running locally - the result will be a string, but if running remotely, the result will be a JSON object for HTTP frame
        #     so we need to see if we can parse the JSON, and if not, just use the string
        try:
            response = response.json()
            response = json.loads(response['body']) if 'body' in response else response
        except json.JSONDecodeError:
            response = response.text

        self.assertEqual(response['stage'], 'Full Source Code Import')

    def test_generator_resource_projectsource_stage_filescan_customrepo(self):
        print("Running test: Generator Resource ProjectSource Stage Filescan - Custom Repo")

        project_name = PRIVATE_PROJECT_NAME_CHECKIN_TEST

        data = {"stage": 'File Paths Scan'}
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)

        # response = requests.post(f"{TARGET_URL}/test", json=data, headers=signedHeaders)
        # self.assertEqual(response.status_code, 200)

        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/projectsource/generator/process", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        # if running locally - the result will be a string, but if running remotely, the result will be a JSON object for HTTP frame
        #     so we need to see if we can parse the JSON, and if not, just use the string
        try:
            response = response.json()
            response = json.loads(response['body']) if 'body' in response else response
        except json.JSONDecodeError:
            response = response.text

        self.assertEqual(response['stage'], 'Full Source Code Import')

    def test_generator_resource_projectsource_stage_fullsourceimport(self):
        print("Running test: Generator Resource ProjectSource Stage Filescan")

        project_name = PRIVATE_PROJECT_NAME_CHECKIN_TEST

        data = {"stage": 'Full Source Code Import'}
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)

        response = requests.post(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/projectsource/generator/process", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        # if running locally - the result will be a string, but if running remotely, the result will be a JSON object for HTTP frame
        #     so we need to see if we can parse the JSON, and if not, just use the string
        try:
            response = response.json()
            response = json.loads(response['body']) if 'body' in response else response
        except json.JSONDecodeError:
            response = response.text

        self.assertEqual(response['stage'], 'Complete')

    def test_generator_resource_projectsource_stage_filepathscan_custom_repo(self):
        print("Running test: Generator Resource ProjectSource Stage Filescan")

        project_name = PRIVATE_PROJECT_NAME_CUSTOM_NFTMINT
        email = PREMIUM_EMAIL
        email = "airbear109@gmail.com"

        org = "polyverse-appsec"
        project_name = "nftmintONE"

        dataPathScan = {"stage": 'File Paths Scan'}
        dataSourceImport = {"stage": 'Full Source Code Import'}
        signedHeaders = get_signed_headers(email)

        response = requests.post(f"{TARGET_URL}/api/user_project/{org}/{project_name}/data/projectsource/generator/process", json=dataPathScan, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        # if running locally - the result will be a string, but if running remotely, the result will be a JSON object for HTTP frame
        #     so we need to see if we can parse the JSON, and if not, just use the string
        try:
            response = response.json()
            response = json.loads(response['body']) if 'body' in response else response
        except json.JSONDecodeError:
            response = response.text

        self.assertEqual(response['stage'], dataSourceImport['stage'])

    def test_generator_resource_projectsource_custom_repo(self):
        print("Running test: Generator Resource ProjectSource - Custom Repo")

        project_name = PRIVATE_PROJECT_CUSTOM_NFTMINT

        org = "polyverse-appsec"
        project_name = "nftmintONE"
        email = PREMIUM_EMAIL
        email = "airbear109@gmail.com"

        data = {"status": 'processing'}
        signedHeaders = get_signed_headers(email)

        response = requests.post(f"{TARGET_URL}/api/user_project/{org}/{project_name}/data/projectsource/generator", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        # if running locally - the result will be a string, but if running remotely, the result will be a JSON object for HTTP frame
        #     so we need to see if we can parse the JSON, and if not, just use the string
        try:
            response = response.json()
            response = json.loads(response['body']) if 'body' in response else response
        except json.JSONDecodeError:
            response = response.text

        self.assertEqual(response['stage'], 'Complete')

    def test_generator_resource_projectsource_stage_fullsourceimport_custom_repo(self):
        print("Running test: Generator Resource ProjectSource Stage Filescan - Custom Repo")

        project_name = PRIVATE_PROJECT_CUSTOM_NFTMINT

        org = "polyverse-appsec"
        project_name = "nftmintONE"
        email = PREMIUM_EMAIL
        email = "airbear109@gmail.com"

        # data = {"stage": 'File Paths Scan'}
        data = {"stage": 'Full Source Code Import', "forceProcessing": True}
        signedHeaders = get_signed_headers(email)

        response = requests.post(f"{TARGET_URL}/api/user_project/{org}/{project_name}/data/projectsource/generator/process", json=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        # if running locally - the result will be a string, but if running remotely, the result will be a JSON object for HTTP frame
        #     so we need to see if we can parse the JSON, and if not, just use the string
        try:
            response = response.json()
            response = json.loads(response['body']) if 'body' in response else response
        except json.JSONDecodeError:
            response = response.text

        self.assertEqual(response['stage'], 'Complete')

    def test_resource_projectsource_oversized_payload(self):
        print("Running test: Save Oversized ProjectSource data (simulated large payload)")

        project_name = PRIVATE_PROJECT_NAME_CHECKIN_TEST

        # create a 400k payload of plain text
        data = "a" * 400000
        signedHeaders = get_signed_headers(PREMIUM_EMAIL)
        # Set the 'Content-Type' header to 'text/plain'
        signedHeaders['Content-Type'] = 'text/plain'

        response = requests.delete(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/projectsource", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.put(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/projectsource", data=data, headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        response = requests.get(f"{TARGET_URL}/api/user_project/{ORG}/{project_name}/data/projectsource", headers=signedHeaders)
        self.assertEqual(response.status_code, 200)

        # if running locally - the result will be a string, but if running remotely, the result will be a JSON object for HTTP frame
        #     so we need to see if we can parse the JSON, and if not, just use the string
        try:
            response = response.json()
            response = response['body'] if 'body' in response else response
        except json.JSONDecodeError:
            response = response.text

        self.assertEqual(response, data)
