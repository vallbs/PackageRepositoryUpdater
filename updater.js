const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const { exec } = require('child_process');
const { format } = require('date-fns');
const simpleGit = require('simple-git');

dotenv.config();

const BITBUCKET_WORKSPACE = process.env.BITBUCKET_WORKSPACE;
const BITBUCKET_REPO_ID = process.env.BITBUCKET_REPO_ID;
const BITBUCKET_URL = process.env.BITBUCKET_URL;
const MAIN_BRANCH_NAME = process.env.MAIN_BRANCH_NAME;
const BITBUCKET_ACCESS_TOKEN = process.env.BITBUCKET_ACCESS_TOKEN;

async function updatePackageJson(name, version) {
    try {
        console.info('updating the package version in package.json ...');

        const packageJSON = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        packageJSON.dependencies[name] = version;
        fs.writeFileSync('package.json', JSON.stringify(packageJSON, null, 2));
    } catch(error) {
        console.info('Error on updating the package version in package.json ...');
    }
    
}

async function updatePackageLock(packageName) {
    try {
        console.info('updating the package version in package-lock.json ...');

        await exec(`npm install ${packageName}`);
    } catch(error) {
        console.error('Error on updating the package version in package-lock.json ...');
    }

    try {
        await exec('npm install');
    } catch (error) {
        throw new Error(`Error generating or updating package-lock.json: ${error.message}`);
    }
}

function getBranchUrl() {
    return `${BITBUCKET_URL}/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_ID}/refs/branches`;
}

function generateUniqueBranchName(baseName) {
    const currentDate = new Date();
    const formattedDate = format(currentDate, 'yyyy-MM-dd-HH-mm-ss');
    return `${baseName}-${formattedDate}`;
}

function getHeaders() {
    return {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BITBUCKET_ACCESS_TOKEN}`
    }
}

async function createBranch(packageName) {
    const newBranchName = generateUniqueBranchName(packageName);
    const bodyData = {
        name: newBranchName,
        target: {
            hash: MAIN_BRANCH_NAME,
        }
    }
    const brahcnUrl = getBranchUrl();

    try {
        console.info(`creating branch ${newBranchName} ...`);
        const { data: { name } = {} } = await axios.post(brahcnUrl, bodyData, {
            headers: getHeaders()
        });
        console.info(`branch ${newBranchName} was successfully created`);
        
        return name;
    } catch (error) {
        console.error(`error on creating branch ${newBranchName}`);
    }
}

async function createPullRequest(branchName, packageName) {
    try {
        console.info('creating pull request ...');

        const data = {
            title: `chore: bump ${packageName} package`,
            description: `Auto-generated PR for updating version of ${packageName} in package.json and package-lock.json`,
            source: {
                branch: {
                    name: branchName,
                }
            },
            destination: {
                branch: {
                    name: MAIN_BRANCH_NAME,
                }
            },
            source_commit: {
                hash: branchName
            },
        };

        const url = `${BITBUCKET_URL}/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_ID}/pullrequests`;

        await axios.post(url, data, {
            headers: getHeaders(),
        });
        console.info('pull request was created successfully');
    } catch (error) {
        console.error('error on creating pull request ...');
    }
}

async function checkoutToMainAndPull(gitInstance) {
    try {
        console.info('checking out to the main branch...');
        await gitInstance.checkout('main');

        console.info('pulling from the main branch...');
        await gitInstance.pull();
    } catch (error) {
        console.error('error on checking out to the main branch')
    }
}

async function processChangesWithGit(gitInstance, branchName) {
    try {
        console.info(`checking out to the local branch ${branchName} ...`);
        await gitInstance.checkoutLocalBranch(branchName);

        console.info(`adding changes to the stage ...`);
        await gitInstance.add(['package.json', 'package-lock.json']);

        console.info(`creating the commit ...`);
        await gitInstance.commit('Updated package.json and package-lock.json files');

        console.info(`pushing to the BitBucket repo ...`);
        await gitInstance.push('origin', branchName);
    } catch(error) {
        console.error(`error on processing changes with git`);
    }
}

async function main() {
    if (!MAIN_BRANCH_NAME || !BITBUCKET_ACCESS_TOKEN) {
        console.error(`Please provide in the ".env" file the following: BitBucket main branch name and Access Token`);
        process.exit(1);
    };

    console.info('reading arguments ...');
    const packageName = process.argv[2];
    const packageVersion = process.argv[3];
    const workspace = process.argv[4] || BITBUCKET_WORKSPACE;
    const repo_id = process.argv[5] || BITBUCKET_REPO_ID;

    if (!packageName || !packageVersion || !workspace || !repo_id) {
        console.error('Please run command with the following arguments: node update-package.js <package-name> <package-version> <workspace_name> <repo_name>');
        process.exit(1);
    }

    try {
        const gitInstance = simpleGit();
        await checkoutToMainAndPull(gitInstance);
        await updatePackageJson(packageName, packageVersion);
        await updatePackageLock(packageName);

        const branchName = await createBranch(packageName);
        await processChangesWithGit(gitInstance, branchName);
        await createPullRequest(branchName, packageName);

        process.exit(0);
    } catch(error) {
        process.exit(1);
    }
}

main();
