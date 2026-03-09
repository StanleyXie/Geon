/**
 * LocalModelAdapter
 * 
 * Connecting to local models (e.g., llama.cpp, Ollama, MLX LM)
 * via an OpenAI-compatible /v1/chat/completions endpoint.
 */

import type { CanonicalMessage } from "../context/types.js";
import type { NormalizedChunk, ProviderAdapter } from "./types.js";
import { toOpenAIMessages } from "./types.js";
import { BUILT_IN_TOOLS } from "../tools/definitions.js";
import { toOpenAITools } from "../tools/converters.js";

interface ToolCallState {
    id: string;
    name: string;
    arguments: string;
}

export class LocalModelAdapter implements ProviderAdapter {
    readonly provider = "local" as const;
    readonly modelId: string;
    readonly endpoint: string;
    readonly apiKey?: string;

    constructor(modelId: string, options?: { endpoint?: string; apiKey?: string }) {
        this.modelId = modelId;
        this.endpoint = options?.endpoint || "http://localhost:8000/v1";
        this.apiKey = options?.apiKey;
    }

    async *stream(
        _sessionId: string,
        messages: CanonicalMessage[],
        systemPrompt: string,
        _tools: readonly unknown[],
        signal: AbortSignal,
    ): AsyncIterable<NormalizedChunk> {
        const url = `${this.endpoint.replace(/\/$/, "")}/chat/completions`;
        const openAIMessages = toOpenAIMessages(messages);

        // Prepend system prompt if provided and not already in messages
        if (systemPrompt && !openAIMessages.some(m => m.role === "system")) {
            openAIMessages.unshift({ role: "system", content: systemPrompt });
        }

        const body = {
            model: this.modelId,
            messages: openAIMessages,
            stream: true,
            stream_options: { include_usage: true },
            tools: toOpenAITools(BUILT_IN_TOOLS),
            tool_choice: "auto",
        };

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (this.apiKey) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Local model API error (${response.status}): ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("Local model API response body is empty");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        // Accumulators for tool calls and usage
        const toolCalls = new Map<number, ToolCallState>();
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheHitTokens = 0;

        // --- Stream Cleaner State ---
        let stopTriggered = false;
        let textBuffer = ""; // used to check for stop sequences

        const cleanText = (text: string): string => {
            if (stopTriggered) return "";

            // 1. Remove raw chat delimiters that often leak from local models
            let cleaned = text
                .replace(/<\|im_end\|>/g, "")
                .replace(/<\|im_start\|>/g, "")
                .replace(/<\|endoftext\|>/g, "")
                .replace(/<\|end_of_turn\|>/g, "");

            // 2. Prevent hallucinated "User:" turns (the "hallucination loop")
            const stopSequences = ["\n## User", "\nUser:", "\n## Assistant", "\nAssistant:"];
            textBuffer += cleaned;
            for (const seq of stopSequences) {
                const idx = textBuffer.indexOf(seq);
                if (idx !== -1) {
                    stopTriggered = true;
                    // Return the portion before the stop sequence
                    const result = textBuffer.substring(0, idx);
                    textBuffer = ""; // clear so we don't return it again 
                    return result;
                }
            }

            // Keep buffer reasonable for stop sequence detection
            if (textBuffer.length > 200) textBuffer = textBuffer.slice(-100);

            return cleaned;
        };
        // --- End Stream Cleaner ---

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || trimmedLine === "data: [DONE]") continue;
                    if (trimmedLine.startsWith("data: ")) {
                        const jsonStr = trimmedLine.substring(6);

                        try {
                            const data = JSON.parse(jsonStr);

                            // Capture usage if present
                            if (data.usage) {
                                inputTokens = data.usage.prompt_tokens || inputTokens;
                                outputTokens = data.usage.completion_tokens || outputTokens;

                                // Try to find cache hit tokens (OpenAI style or common extensions)
                                const cached = data.usage.prompt_tokens_details?.cached_tokens
                                    || data.usage.prompt_cache_hit_tokens
                                    || data.usage.cache_hit_tokens;

                                if (cached !== undefined && cached > 0) {
                                    cacheHitTokens = cached;
                                }
                            }

                            const choice = data.choices?.[0];
                            const delta = choice?.delta;

                            if (delta?.content) {
                                const outText = cleanText(delta.content);
                                if (outText) {
                                    yield { type: "text", text: outText };
                                }
                                if (stopTriggered) break; // Exit loop if we hit a hallucinated turn
                            }

                            if (delta?.tool_calls) {
                                for (const tc of delta.tool_calls) {
                                    const index = tc.index ?? 0;
                                    let state = toolCalls.get(index);

                                    if (!state) {
                                        state = { id: tc.id || "", name: tc.function?.name || "", arguments: "" };
                                        toolCalls.set(index, state);
                                    }

                                    if (tc.id) state.id = tc.id;
                                    if (tc.function?.name) state.name = tc.function.name;
                                    if (tc.function?.arguments) state.arguments += tc.function.arguments;
                                }
                            }

                            if (choice?.finish_reason === "tool_calls" || (choice?.finish_reason === "stop" && toolCalls.size > 0)) {
                                for (const [index, state] of toolCalls) {
                                    try {
                                        yield {
                                            type: "tool_call",
                                            toolName: state.name,
                                            toolInput: JSON.parse(state.arguments || "{}"),
                                            toolUseId: state.id || `call_${index}_${Math.random().toString(36).substring(7)}`,
                                        };
                                    } catch (e) {
                                        process.stderr.write(`[GEON] Error parsing aggregated tool arguments: ${e}\nRaw: ${state.arguments}\n`);
                                    }
                                }
                                toolCalls.clear();
                            }
                        } catch (e) {
                            process.stderr.write(`[GEON] Error parsing local model SSE chunk: ${e}\nChunk: ${jsonStr}\n`);
                        }
                    }
                }
                if (stopTriggered) {
                    reader.cancel(); // Close the connection if we hit a stop sequence
                    break;
                }
            }

            // Final fallback for tool calls
            if (toolCalls.size > 0) {
                for (const [index, state] of toolCalls) {
                    try {
                        yield {
                            type: "tool_call",
                            toolName: state.name,
                            toolInput: JSON.parse(state.arguments || "{}"),
                            toolUseId: state.id || `call_${index}_${Math.random().toString(36).substring(7)}`,
                        };
                    } catch (e) {
                        process.stderr.write(`[GEON] Error parsing final tool arguments: ${e}\n`);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield {
            type: "done",
            inputTokens,
            outputTokens,
            cacheHitTokens,
        };
    }
}
