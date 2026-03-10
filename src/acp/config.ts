/**
 * Configuration for individual providers.
 */
export interface ProviderConfig {
    /** Whether the provider is enabled. */
    enabled: boolean;
    /** API Key for the provider (overrides environment variables). */
    apiKey?: string;
    /** Default model ID to use for this provider. */
    defaultModel?: string;
    /** Additional provider-specific parameters. */
    parameters?: Record<string, unknown>;
}

/**
 * Root configuration structure for GEON settings in Zed.
 */
export interface GeonSettings {
    /** Map of provider configurations. */
    providers: {
        google?: ProviderConfig;
        anthropic?: ProviderConfig;
        local?: ProviderConfig;
        llama_cpp?: ProviderConfig;
        lmstudio?: ProviderConfig;
        [key: string]: ProviderConfig | undefined;
    };
    /** Global default model ID. */
    defaultModel?: string;
}

/**
 * Default settings for GEON.
 */
export const DEFAULT_SETTINGS: GeonSettings = {
    providers: {
        google: {
            enabled: true,
            defaultModel: "gemini-2.5-flash",
        },
        anthropic: {
            enabled: true,
            defaultModel: "claude-3-5-sonnet-20240620",
        },
        local: {
            enabled: true,
            defaultModel: "qwen3.5-9b",
            parameters: {
                endpoint: "http://localhost:1234/v1"
            }
        },
        llama_cpp: {
            enabled: true,
            defaultModel: "llama-3-8b",
            parameters: {
                endpoint: "http://localhost:8000/v1"
            }
        },
        lmstudio: {
            enabled: true,
            defaultModel: "qwen3.5-9b-mlx",
            parameters: {
                endpoint: "http://localhost:8000/v1"
            }
        }
    },
    defaultModel: "gemini-2.5-flash",
};

/**
 * Utility to merge incoming client settings with defaults.
 */
export function mergeSettings(
    current: GeonSettings,
    incoming: Record<string, unknown>,
): GeonSettings {
    process.stderr.write(`[GEON] mergeSettings incoming: ${JSON.stringify(incoming)}\n`);
    // Simple merge logic - in a real app this might be more robust
    const merged = { ...current };

    if (incoming["providers"] && typeof incoming["providers"] === "object") {
        const incomingProviders = incoming["providers"] as Record<string, unknown>;
        for (const [key, value] of Object.entries(incomingProviders)) {
            if (value && typeof value === "object") {
                merged.providers[key] = {
                    ...merged.providers[key],
                    ...(value as Partial<ProviderConfig>),
                    enabled: (value as any).enabled ?? merged.providers[key]?.enabled ?? true,
                };
            }
        }
    }

    if (typeof incoming["defaultModel"] === "string" || typeof incoming["default_model"] === "string") {
        merged.defaultModel = (incoming["defaultModel"] || incoming["default_model"]) as string;
    }

    if (typeof incoming["google_api_key"] === "string") {
        process.stderr.write(`[GEON] Setting google_api_key from flat param\n`);
        merged.providers.google = { ...merged.providers.google, enabled: true, apiKey: incoming["google_api_key"] };
    }
    if (typeof incoming["google_enabled"] === "boolean") {
        merged.providers.google = { ...merged.providers.google, enabled: incoming["google_enabled"] };
    }
    if (typeof incoming["anthropic_api_key"] === "string") {
        merged.providers.anthropic = { ...merged.providers.anthropic, enabled: true, apiKey: incoming["anthropic_api_key"] };
    }
    if (typeof incoming["anthropic_enabled"] === "boolean") {
        merged.providers.anthropic = { ...merged.providers.anthropic, enabled: incoming["anthropic_enabled"] };
    }
    if (typeof incoming["local_enabled"] === "boolean") {
        merged.providers.local = { ...merged.providers.local, enabled: incoming["local_enabled"] };
    }
    if (typeof incoming["local_endpoint"] === "string") {
        merged.providers.local = {
            ...merged.providers.local,
            enabled: true,
            parameters: { ...merged.providers.local?.parameters, endpoint: incoming["local_endpoint"] }
        };
    }
    if (typeof incoming["llama_cpp_enabled"] === "boolean") {
        merged.providers.llama_cpp = { ...merged.providers.llama_cpp, enabled: incoming["llama_cpp_enabled"] };
    }
    if (typeof incoming["llama_cpp_endpoint"] === "string") {
        merged.providers.llama_cpp = {
            ...merged.providers.llama_cpp,
            enabled: true,
            parameters: { ...merged.providers.llama_cpp?.parameters, endpoint: incoming["llama_cpp_endpoint"] }
        };
    }
    if (typeof incoming["lmstudio_enabled"] === "boolean") {
        merged.providers.lmstudio = { ...merged.providers.lmstudio, enabled: incoming["lmstudio_enabled"] };
    }
    if (typeof incoming["lmstudio_endpoint"] === "string") {
        merged.providers.lmstudio = {
            ...merged.providers.lmstudio,
            enabled: true,
            parameters: { ...merged.providers.lmstudio?.parameters, endpoint: incoming["lmstudio_endpoint"] }
        };
    }

    process.stderr.write(`[GEON] mergeSettings result: ${JSON.stringify(merged)}\n`);
    return merged;
}
