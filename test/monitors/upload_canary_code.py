import sys
import zipfile
import os
import boto3
from botocore.exceptions import NoCredentialsError, ClientError, ParamValidationError

def zip_file(file_path, zip_path):
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        zipf.write(file_path, os.path.basename(file_path))

def upload_to_lambda(zip_path, function_arn):
    lambda_client = boto3.client('lambda')
    try:
        with open(zip_path, 'rb') as zip_file:
            lambda_client.update_function_code(
                FunctionName=function_arn,
                ZipFile=zip_file.read()
            )
        print(f"Successfully updated {function_arn} with {zip_path}")
    except (NoCredentialsError, ClientError, ParamValidationError) as e:
        print(f"Failed to update the Lambda function: {str(e)}")

def extract_arn_from_file(file_path):
    with open(file_path, 'r') as file:
        first_line = file.readline().strip()
        if first_line.startswith('//'):
            return first_line.split(' ')[1]
    return None

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python update_canary.py <path_to_js_file>")
        sys.exit(1)

    script_file = sys.argv[1]
    zip_file_name = f"{os.path.splitext(script_file)[0]}.zip"

    function_arn = extract_arn_from_file(script_file)
    if not function_arn:
        print("Failed to extract ARN from the script file.")
        sys.exit(1)

    zip_file(script_file, zip_file_name)
    upload_to_lambda(zip_file_name, function_arn)
