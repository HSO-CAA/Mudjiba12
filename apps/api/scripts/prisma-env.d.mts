export declare const API_ROOT: string;
export declare function envFiles(apiRoot?: string): string[];
export declare function loadEnvFiles(files?: string[], target?: NodeJS.ProcessEnv): string[];
export declare function databaseUrlProblem(url: string | undefined, command?: string): string | null;
