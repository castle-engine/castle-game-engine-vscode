const vscode = require("vscode");

// https://stackoverflow.com/questions/30763496/how-to-promisify-nodes-child-process-exec-and-child-process-execfile-functions
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const castlePath = require('./castlePath.js');

/**
 * Executes command and returns stdout as string (empty string on error, 
 * but shows showErrorMessage()).
 * @param {string} command command to run
 * @returns {string} stdout or empty string on error
 */
async function executeCommandAndReturnValue(command) {
	let result = '';

	let options = {};

	if (vscode.workspace.workspaceFolders !== undefined) {
		console.log(vscode.workspace.workspaceFolders[0].uri.path);
		options.cwd = castlePath.pathForExecCommandCwd(vscode.workspace.workspaceFolders[0].uri.path);
	}

	try {
		const { stdout, stderr } = await exec(command, options);
		console.log('stderr:', stderr);

		result = stdout.trim();
		console.log('stdout: ', result);
		return result;

	} catch (e) {
		vscode.window.showErrorMessage(`Error: ${e.message}`);
		return result;
	}
}

/**
 * Executes command, shows error in vscode error message.
 * @param {string} command command to run
 */
async function executeCommand(command) {
	let options = {};

	if (vscode.workspace.workspaceFolders !== undefined) {
		console.log(vscode.workspace.workspaceFolders[0].uri.path);
		options.cwd = castlePath.pathForExecCommandCwd(vscode.workspace.workspaceFolders[0].uri.path);
	}

	try {
		await exec(command, options);
	} catch (e) {
		vscode.window.showErrorMessage(`Error: ${e.message}`);
	}
}

module.exports = { executeCommandAndReturnValue, executeCommand };