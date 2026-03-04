/**
 * auth_manager.ts — Secure Environment Variable Manager
 *
 * Reads the .env file and provides typed access to API keys and config.
 * Validates that all required keys are present at startup.
 * Throws descriptive errors listing missing keys.
 *
 * Usage:
 *   const auth = new AuthManager(['ANTHROPIC_API_KEY', 'GEMINI_API_KEY']);
 *   const key = auth.get('ANTHROPIC_API_KEY');
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";

export class MissingEnvVarsError extends Error {
    public readonly missingKeys: string[];

    constructor(missingKeys: string[]) {
        super(
            `Missing required environment variables: ${missingKeys.join(", ")}. ` +
            `Copy .env.example to .env and fill in the values.`
        );
        this.name = "MissingEnvVarsError";
        this.missingKeys = missingKeys;
    }
}

export class AuthManager {
    private envVars: Record<string, string> = {};
    private loaded: boolean = false;

    /**
     * Create an AuthManager and validate required keys exist.
     *
     * @param requiredKeys - Array of env var names that MUST be present
     * @param envPath - Path to .env file (default: project root)
     * @throws MissingEnvVarsError if any required keys are missing
     */
    constructor(requiredKeys: string[] = [], envPath?: string) {
        this.load(envPath);
        this.validate(requiredKeys);
    }

    /**
     * Get an environment variable value.
     *
     * @param key - The env var name
     * @param defaultValue - Fallback if not set (only for optional vars)
     * @returns The value, or defaultValue, or undefined
     */
    get(key: string, defaultValue?: string): string | undefined {
        return this.envVars[key] || process.env[key] || defaultValue;
    }

    /**
     * Get an environment variable, throwing if it doesn't exist.
     * Use for required keys that should have been validated at construction.
     */
    getRequired(key: string): string {
        const value = this.get(key);
        if (!value) {
            throw new MissingEnvVarsError([key]);
        }
        return value;
    }

    /**
     * Get a config object with multiple keys.
     * Useful for passing to connector constructors.
     */
    getConfig(keys: string[]): Record<string, string> {
        const config: Record<string, string> = {};
        for (const key of keys) {
            const value = this.get(key);
            if (value) {
                config[key] = value;
            }
        }
        return config;
    }

    /**
     * Check if a key exists and has a non-empty value.
     */
    has(key: string): boolean {
        const value = this.get(key);
        return value !== undefined && value !== "";
    }

    private load(envPath?: string): void {
        if (this.loaded) return;

        const resolvedPath = envPath || path.resolve(__dirname, "..", "..", ".env");

        if (fs.existsSync(resolvedPath)) {
            const result = dotenv.config({ path: resolvedPath });
            if (result.parsed) {
                this.envVars = result.parsed;
            }
        } else {
            console.warn(`[auth_manager] No .env file found at ${resolvedPath}. Using process.env only.`);
        }

        this.loaded = true;
    }

    private validate(requiredKeys: string[]): void {
        if (requiredKeys.length === 0) return;

        const missing = requiredKeys.filter((key) => !this.has(key));

        if (missing.length > 0) {
            throw new MissingEnvVarsError(missing);
        }

        console.log(`[auth_manager] ✅ All ${requiredKeys.length} required env vars present.`);
    }
}
