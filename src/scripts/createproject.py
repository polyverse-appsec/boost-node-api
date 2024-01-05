import os
import sys

def create_project(email, organization, github_repo):
    # Create the project directory
    project_name = f"{organization}_project"
    os.makedirs(project_name, exist_ok=True)

    # Create a simple README file
    readme_content = f"# {project_name}\n\nCreated by {email}\n"
    with open(os.path.join(project_name, "README.md"), "w") as file:
        file.write(readme_content)

    print(f"Project {project_name} created")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python createproject.py <email> <organization> <github_repo>")
        sys.exit(1)

    email = sys.argv[1]
    organization = sys.argv[2]
    github_repo = sys.argv[3]

    create_project(email, organization, github_repo)