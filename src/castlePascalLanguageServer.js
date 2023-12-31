const fs = require('fs');
const vscode = require('vscode');
const vscodelangclient = require('vscode-languageclient');

// eslint-disable-next-line no-unused-vars
const castleConfiguration = require('./castleConfiguration.js');
const castleExec = require('./castleExec.js');
const castlePath = require('./castlePath.js');

/**
 * A class for managing the Pascal Language Server
 */
class CastlePascalLanguageServer {

    /**
     * @param {castleConfiguration.CastleConfiguration} castleConfig 
     */
    constructor(castleConfig) {
        this._castleConfig = castleConfig;
        this._pascalServerClient = null;
    }

    /**
     * @returns {vscodelangclient.LanguageClient|null} LanguageClient or null when not available
     */
    get pascalServerClient() {
        return this._pascalServerClient;
    }

    /**
     * Loads or tries to automatically detect settings
     * @returns {boolean} result of loading settings
     */
    async loadOrDetectSettings() {
        this.enviromentForPascalServer = {};
        if (this._castleConfig.pascalServerPath === '' || this._castleConfig.buildToolPath === '')
            return false;

        // get default compiler path for build tool 
        let defaultCompilerExePath = await castleExec.executeCommandAndReturnValue(castlePath.pathForExecCommand(this._castleConfig.buildToolPath) + ' output-environment fpc-exe');

        // read settings when and fallback to defaultCompilerExePath
        this.enviromentForPascalServer['PP'] = this.getEnvSetting('PP', defaultCompilerExePath);

        // when build tool did not return fpc path for example when this is old build tool
        // try simply run fpc -PB
        if (this.enviromentForPascalServer['PP'] === '')
            this.enviromentForPascalServer['PP'] = await castleExec.executeCommandAndReturnValue('fpc -PB');

        // Check compiler really exists and can be executed
        try {
            fs.accessSync(this.enviromentForPascalServer['PP'], fs.constants.X_OK)
        }
        catch (err) {
            vscode.window.showErrorMessage(`FPC compiler executable not found or can't be executed. ${err}`);
            return false;
        }

        this.enviromentForPascalServer['FPCDIR'] = this.getEnvSetting('FPCDIR', '');

        if (this.enviromentForPascalServer['FPCDIR'] === '') {
            // try to find fpc sources
            let realCompilerPath = await castleExec.executeCommandAndReturnValue(castlePath.pathForExecCommand(this.enviromentForPascalServer['PP']) + ' -PB');
            this.enviromentForPascalServer['FPCDIR'] = await this.tryToFindFpcSources(realCompilerPath);
        }

        this.enviromentForPascalServer['LAZARUSDIR'] = this.getEnvSetting('LAZARUSDIR', '');

        if (this.enviromentForPascalServer['LAZARUSDIR'] === '') {
            let realCompilerPath = await castleExec.executeCommandAndReturnValue(castlePath.pathForExecCommand(this.enviromentForPascalServer['PP']) + ' -PB');
            this.enviromentForPascalServer['LAZARUSDIR'] = await this.tryToFindLazarusSources(realCompilerPath);
        }

        let fpcDefaultTarget = process.platform;
        // win32 can be 32 or 64 bit windows
        if (fpcDefaultTarget === 'win32')
            fpcDefaultTarget = 'windows'

        this.enviromentForPascalServer['FPCTARGET'] = this.getEnvSetting('FPCTARGET', fpcDefaultTarget);

        // try to detect default architecture
        let fpcDefaultArch = process.arch;
        if (fpcDefaultArch === 'x64')
            fpcDefaultArch = 'x86_64';
        else if (fpcDefaultArch === 'arm64')
            fpcDefaultArch = 'aarch64';
        else if (fpcDefaultArch === 'x32')
            fpcDefaultArch = 'i386';
        else
            fpcDefaultArch = '';

        this.enviromentForPascalServer['FPCTARGETCPU'] = this.getEnvSetting('FPCTARGETCPU', fpcDefaultArch);
    }

    async createLanguageClient() {
        if (await this.loadOrDetectSettings() === false)
            return false;

        let run = {
            command: this._castleConfig.pascalServerPath,
            options: {
                env: this.enviromentForPascalServer
            }
        };

        let debug = run;
        let serverOptions = {
            run: run,
            debug: debug
        };

        let clientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'pascal' },
                { scheme: 'untitled', language: 'pascal' }
            ],
            //		initializationOptions : {
            //			option: 'value',
            //		}

        }

        this._pascalServerClient = new vscodelangclient.LanguageClient('pascal-language-server', 'Pascal Language Server', serverOptions, clientOptions);
        await this._pascalServerClient.start();
        return true;
    }

    /**
     * Destorys _pascalServerClient. Used when configuration changes.
     */
    async destroyLanguageClient() {
        if (this._pascalServerClient != undefined) {
            try {
                await this._pascalServerClient.stop();

            } catch (e) {
                vscode.window.showErrorMessage(`Error: ${e.message}`);
            }
            this._pascalServerClient = null;
        }
    }

    /**
     * Gets value fom vscode configuration, env variable or the default value.
     * @param {string} envVarName 
     * @param {string} defaultValue
     */
    getEnvSetting(envVarName, defaultValue) {
        // First check configuration
        let varValue = vscode.workspace.getConfiguration('castleGameEngine.pascalLanguageServer').get(envVarName);

        if (varValue.trim() === '') {
            // Then check environment variable
            if (process.env.envVarName) {
                varValue = process.env.envVarName;
            }
        }

        // At least try default value
        if (varValue.trim() === '') {
            varValue = defaultValue;
        }

        return varValue;
    }


    /**
     * Checks the folder is Free Pascal Compiler sources directory
     * @param {string} folder directory to check
     * @returns {boolean} is it looks like a sources folder? true - yes, false - no
     */
    isCompilerSourcesFolder(folder) {
        try {
            fs.accessSync(folder, fs.constants.F_OK)
            fs.accessSync(folder + '/rtl', fs.constants.F_OK)
            fs.accessSync(folder + '/packages', fs.constants.F_OK)
            return true;
        }
        catch (err) {
            return false;
        }
    }

    /**
     * 
     * @param {string} fpcCompilerExec path to fpc
     * @returns {string} path to fpc sources or '' when not found
     */
    async tryToFindFpcSources(fpcCompilerExec) {
        if (fpcCompilerExec === '')
            return '';

        if (process.platform === 'linux') {
            // check current fpc is not done by fpcupdeluxe
            let sourcesDir = fpcCompilerExec;
            let index = sourcesDir.indexOf('fpc/bin');
            if (index > 0) {
                sourcesDir = sourcesDir.substring(0, index) + 'fpcsrc';
                if (this.isCompilerSourcesFolder(sourcesDir)) {
                    console.log('Found fpc sources:', sourcesDir);
                    return sourcesDir;
                }
            }

            // when fpc-src is installed from fpc-src debian package
            // sources are in directory like /usr/share/fpcsrc/3.2.2/
            // https://packages.debian.org/bookworm/all/fpc-source-3.2.2/filelist
            let compilerVersion = await castleExec.executeCommandAndReturnValue(castlePath.pathForExecCommand(fpcCompilerExec) + ' -iV');
            console.log('Compiler Version', compilerVersion);
            sourcesDir = '/usr/share/fpcsrc/' + compilerVersion + '/';
            if (this.isCompilerSourcesFolder(sourcesDir)) {
                console.log('Found lazarus sources:', sourcesDir);
                return sourcesDir;
            }

        } else
            if (process.platform === 'win32') {
                // check current fpc is not done by fpcupdeluxe
                let sourcesDir = fpcCompilerExec;
                let index = sourcesDir.indexOf('fpc\\bin');
                if (index > 0) {
                    sourcesDir = sourcesDir.substring(0, index) + 'fpcsrc';
                    if (this.isCompilerSourcesFolder(sourcesDir)) {
                        console.log('Found fpc sources:', sourcesDir);
                        return sourcesDir;
                    }
                }
                // check is it boundled fpc
                sourcesDir = fpcCompilerExec;
                index = sourcesDir.indexOf('bin');
                sourcesDir = sourcesDir.substring(0, index) + 'src';
                if (this.isCompilerSourcesFolder(sourcesDir)) {
                    console.log('Found fpc sources:', sourcesDir);
                    return sourcesDir;
                }
            } else
                if (process.platform === 'darwin') {
                    //TODO: macos support
                }

        // sources not found
        return '';
    }

    /**
     * Checks given folder is lazarus sources folder
     * @param {string} folder directory to check
     * @returns {boolean} is it looks like a sources folder? true - yes, false - no
     */
    isLazarusSourcesFolder(folder) {
        try {
            fs.accessSync(folder, fs.constants.F_OK)
            fs.accessSync(folder + '/lcl', fs.constants.F_OK)
            fs.accessSync(folder + '/ide', fs.constants.F_OK)
            fs.accessSync(folder + '/components', fs.constants.F_OK)
            return true;
        }
        catch (err) {
            return false;
        }
    }

    /**
     * This function gets directory like /usr/lib/lazarus/ and seraches for
     * version directory e.g. /usr/lib/lazarus/2.2.6/
     * @param {string} folder directory in which we want to check the subdirectories
     * @returns {string} Lazarus source directory or empty string
     */
    findFullLazarusSourcesFolder(folder) {

        try {
            fs.accessSync(folder, fs.constants.R_OK)
        }
        catch (err) {
            return '';
        }

        try {
            const items = fs.readdirSync(folder);
            for (const item of items) {
                if (this.isLazarusSourcesFolder(folder + item)) {
                    return folder + item;
                }
            }
        }
        catch (err) {
            return '';
        }
    }

    /**
     * 
     * @param {string} fpcCompilerExec path to fpc
     * @returns {string} path to lazarus sources
     */
    async tryToFindLazarusSources(fpcCompilerExec) {
        if (fpcCompilerExec === '')
            return '';

        if (process.platform === 'linux') {
            // check current fpc is not done by fpcupdeluxe then lazarus is in lazarus subfolder
            let sourcesDir = fpcCompilerExec;
            let index = sourcesDir.indexOf('fpc/bin');
            if (index > 0) {

                sourcesDir = sourcesDir.substring(0, index) + 'lazarus';
                if (this.isLazarusSourcesFolder(sourcesDir)) {
                    console.log('Found lazarus sources:', sourcesDir);
                    return sourcesDir;
                }
            }

            // default lazarus sources folder path in debian
            // looks like /usr/lib/lazarus/2.2.6/
            // so we need iterate all items in that directory 
            // https://packages.debian.org/bookworm/all/lazarus-src-2.2/filelist
            sourcesDir = this.findFullLazarusSourcesFolder('/usr/lib/lazarus/');
            if (sourcesDir !== '') {
                console.log('Found lazarus sources:', sourcesDir);
                return sourcesDir;
            }
        } else
            if (process.platform === 'win32') {
                // check current fpc is not done by fpcupdeluxe then lazarus is in lazarus subfolder
                let sourcesDir = fpcCompilerExec;
                let index = sourcesDir.indexOf('fpc\\bin');
                if (index > 0) {

                    sourcesDir = sourcesDir.substring(0, index) + 'lazarus';
                    if (this.isLazarusSourcesFolder(sourcesDir)) {
                        console.log('Found lazarus sources:', sourcesDir);
                        return sourcesDir;
                    }
                }
            } else
                if (process.platform === 'darwin') {
                    //TODO: macos support
                }

        // no sources dir found
        return '';
    }
}

module.exports = CastlePascalLanguageServer;