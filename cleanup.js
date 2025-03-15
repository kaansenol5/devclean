const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const os = require('os');

// Configuration
const PROJECT_TYPES = {
    NODE: {
        depFolder: 'node_modules',
        configFiles: ['package.json', 'package-lock.json', 'yarn.lock']
    },
    PYTHON: {
        depFolder: 'venv',
        configFiles: ['requirements.txt', 'Pipfile', 'poetry.lock']
    }
};

const TARGET_DIRS = [
    'node_modules',
    'venv',
    '.pytest_cache',
    '__pycache__',
    '.next',
    'dist',
    'build',
    '.gradle',
    'target',
    'vendor',
    '.cargo'
];

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify readline question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function calculateSize(dirPath) {
    let size = 0;
    try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const file of files) {
            const filePath = path.join(dirPath, file.name);
            try {
                // Handle symlinks and regular files/directories differently
                const stat = await fs.lstat(filePath);
                
                if (stat.isSymbolicLink()) {
                    // For symlinks, we'll just count the link itself
                    size += stat.size;
                } else if (stat.isDirectory()) {
                    size += await calculateSize(filePath);
                } else {
                    size += stat.size;
                }
            } catch (error) {
                // Skip files we can't access
                console.log(`Skipping ${filePath}: ${error.message}`);
            }
        }
    } catch (error) {
        console.error(`Error calculating size for ${dirPath}:`, error.message);
    }
    return size;
}

function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

async function detectProjectType(dirPath) {
    const parentDir = path.dirname(dirPath);
    const dirName = path.basename(dirPath);

    for (const [type, config] of Object.entries(PROJECT_TYPES)) {
        if (config.depFolder === dirName) {
            // Check if any config files exist
            for (const configFile of config.configFiles) {
                try {
                    await fs.access(path.join(parentDir, configFile));
                    return { type, config };
                } catch (error) {
                    continue;
                }
            }
        }
    }
    return null;
}

async function verifyConfigFiles(dirPath, projectType) {
    const parentDir = path.dirname(dirPath);
    const missingFiles = [];
    let hasValidConfig = false;

    for (const configFile of projectType.config.configFiles) {
        try {
            const configPath = path.join(parentDir, configFile);
            await fs.access(configPath);
            const stat = await fs.stat(configPath);
            if (stat.size > 0) {
                hasValidConfig = true;
            }
        } catch (error) {
            missingFiles.push(configFile);
        }
    }

    return { isValid: hasValidConfig, missingFiles };
}

async function processTarget(targetPath) {
    try {
        const size = await calculateSize(targetPath);
        const formattedSize = formatSize(size);
        
        console.log(`\nFound: ${targetPath}`);
        console.log(`Size: ${formattedSize}`);

        const projectType = await detectProjectType(targetPath);
        if (projectType) {
            const { isValid, missingFiles } = await verifyConfigFiles(targetPath, projectType);
            if (!isValid) {
                console.log('\nWARNING: Missing or empty configuration files:');
                console.log(missingFiles.join(', '));
                console.log('Deleting this folder might cause issues with dependency restoration.');
            }
        }

        const answer = await question('Delete this folder? (y/n): ');
        if (answer.toLowerCase() === 'y') {
            await fs.rm(targetPath, { recursive: true, force: true });
            console.log('Deleted successfully!');
        }
    } catch (error) {
        console.error(`Error processing ${targetPath}:`, error.message);
    }
}

async function scanDirectory(dirPath) {
    try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const file of files) {
            if (file.name.startsWith('.')) continue;
            
            const fullPath = path.join(dirPath, file.name);
            
            if (file.isDirectory()) {
                if (TARGET_DIRS.includes(file.name)) {
                    await processTarget(fullPath);
                } else {
                    await scanDirectory(fullPath);
                }
            }
        }
    } catch (error) {
        console.error(`Error scanning ${dirPath}:`, error.message);
    }
}

async function main() {
    try {
        const homeDir = os.homedir();
        console.log('Starting scan from:', homeDir);
        await scanDirectory(homeDir);
        console.log('\nScan complete!');
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        rl.close();
    }
}

main(); 