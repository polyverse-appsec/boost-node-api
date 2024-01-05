import os
import sys

def sanitize_email(email):
    """Sanitize the email to create a valid directory name."""
    return email.replace('@', '_')

def create_project(email, organization, repo_name):
    # Sanitize email
    email_dir = sanitize_email(email)

    # Create the directory structure: email/organization/repo_name
    project_path = os.path.join(email_dir, organization, repo_name)
    os.makedirs(project_path, exist_ok=True)

    print(f"Project created at: {project_path}")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python createproject.py <email> <organization> <github_repo>")
        sys.exit(1)

    email = sys.argv[1]
    organization = sys.argv[2]
    github_repo = sys.argv[3]

    create_project(email, organization, github_repo)