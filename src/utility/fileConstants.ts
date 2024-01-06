
export const boostIgnoreFilename = ".boostignore";

export const gitIgnoreFilename = ".gitignore";

export const boostIncludeFilename = ".boostInclude";

export const defaultBoostIgnorePaths = [
    '.vscode',
    'node_modules/',
    '**/.github/**',

    gitIgnoreFilename,
    boostIgnoreFilename,
    boostIncludeFilename,

    'chat/', // exclude all chat files by default
];

export const boostFilterFiles = [
    `**/${boostIgnoreFilename}`,
    `**/${boostIncludeFilename}`,
    `**/${boostIgnoreFilename.toLowerCase()}`,
    `**/${boostIncludeFilename.toLowerCase()}`,
];

export const potentiallyUsefulTextFiles = [
    '**/*.md', // exclude all markdown files by default
    '**/*.txt', // exclude all text files by default
    "**/*.ipynb", // Jupyter notebooks
    "**/*.sql", // SQL scripts
    "**/*.rtf", // Rich text files
    "**/*.csv", // Data files that might be read by scripts
    "**/*.tsv", // Data files that might be read by scripts
    "**/*.dist", // Often used for distribution config files
];

export const defaultIgnoredFolders = [
    '**/node_modules/**',
];

// add common binary file types to the exclude patterns
export const binaryFilePatterns = [
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.png",
    "**/*.gif",
    "**/*.bmp",
    "**/*.tiff",
    "**/*.ico",
    "**/*.pdf",
    "**/*.zip",
    "**/*.tar",
    "**/*.gz",
    "**/*.rar",
    "**/*.7z",
    "**/*.exe",
    "**/*.dll",
    "**/*.so",
    "**/*.bin",
    "**/*.ppt",
    "**/*.pptx",
    "**/*.doc",
    "**/*.docx",
    "**/*.xls",
    "**/*.xlsx",
    "**/*.psd",
    "**/*.ai",
    "**/*.flv",
    "**/*.mp4",
    "**/*.avi",
    "**/*.mkv",
    "**/*.mpeg",
    "**/*.mp3",
    "**/*.wav",
    "**/*.flac",
    "**/*.aac",
    "**/*.ogg",
    "**/*.iso",
    "**/*.dmg",
    "**/*.jar",
    "**/*.war",
    "**/*.ear",
    "**/*.pyc",
    "**/*.pyo",
    "**/*.class",
    "**/*.sqlite",
    "**/*.db",
    "**/*.ttf",
    "**/*.otf",
    "**/*.ipynb_checkpoints",
    "**/*.ipynb_checkpoints/**",
    "**/*.git",
    "**/*.svn",
    "**/*.hg",
    "**/*.bz2",
    "**/*.app",
    "**/*.appx",
    "**/*.appxbundle",
    "**/*.msi",
    "**/*.deb",
    "**/*.rpm",
    "**/*.elf",
    "**/*.sys",
    "**/*.odt",
    "**/*.ods",
    "**/*.odp",
];

export const textFilePatterns = [
    "**/*.svg",
    "**/*.*ignore",
    "**/*.gitignore",
    "**/*.gitattributes",
    "**/*.log",
    "**/*.out",
    "**/*.dockerignore",
    "**/*.gitkeep",
    "**/*.gitmodules",
    "**/*.gitconfig",
];

export const boostTrashFolder = ".trash";
