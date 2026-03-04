/**
 * retry_handler.ts — Exponential Backoff & Circuit Breaker
 *
 * Provides a generic retry wrapper for any async function.
 * - Retries with exponential backoff: 1s, 2s, 4s (configurable)
 * - Circuit breaker: tracks lifetime failures across calls
 * - Throws CIRCUIT_OPEN after maxLifetimeFailures (default: 5)
 */

export interface RetryOptions {
    /** Max retries per call (default: 3) */
    maxRetries?: number;
    /** Initial delay in ms (default: 1000) */
    initialDelayMs?: number;
    /** Backoff multiplier (default: 2) */
    backoffMultiplier?: number;
    /** Max delay cap in ms (default: 30000) */
    maxDelayMs?: number;
    /** Label for logging (default: "operation") */
    label?: string;
}

export class CircuitBreakerOpenError extends Error {
    public readonly failureCount: number;

    constructor(connectorName: string, failureCount: number) {
        super(
            `CIRCUIT_OPEN: ${connectorName} has failed ${failureCount} times across its lifecycle. Circuit breaker is OPEN.`
        );
        this.name = "CircuitBreakerOpenError";
        this.failureCount = failureCount;
    }
}

export class RetryHandler {
    private lifetimeFailures: number = 0;
    private maxLifetimeFailures: number;
    private circuitOpen: boolean = false;
    private connectorName: string;

    constructor(connectorName: string, maxLifetimeFailures: number = 5) {
        this.connectorName = connectorName;
        this.maxLifetimeFailures = maxLifetimeFailures;
    }

    /**
     * Execute an async function with exponential backoff retry.
     *
     * @throws CircuitBreakerOpenError if lifetime failures exceed threshold
     * @throws Error from the wrapped function if all retries exhausted
     */
    async execute<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
        if (this.circuitOpen) {
            throw new CircuitBreakerOpenError(this.connectorName, this.lifetimeFailures);
        }

        const {
            maxRetries = 3,
            initialDelayMs = 1000,
            backoffMultiplier = 2,
            maxDelayMs = 30000,
            label = "operation",
        } = options;

        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await fn();
                // Success — reset is NOT done here (lifetime tracking stays)
                return result;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                this.lifetimeFailures++;

                console.warn(
                    `[retry_handler] ${this.connectorName}::${label} attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`
                );

                // Check circuit breaker
                if (this.lifetimeFailures >= this.maxLifetimeFailures) {
                    this.circuitOpen = true;
                    throw new CircuitBreakerOpenError(this.connectorName, this.lifetimeFailures);
                }

                // Don't delay after last attempt
                if (attempt < maxRetries) {
                    const delay = Math.min(
                        initialDelayMs * Math.pow(backoffMultiplier, attempt),
                        maxDelayMs
                    );
                    console.log(`[retry_handler] Retrying in ${delay}ms...`);
                    await this.sleep(delay);
                }
            }
        }

        throw lastError || new Error(`${label} failed after ${maxRetries + 1} attempts`);
    }

    /** Check if the circuit breaker is open */
    isOpen(): boolean {
        return this.circuitOpen;
    }

    /** Get current lifetime failure count */
    getFailureCount(): number {
        return this.lifetimeFailures;
    }

    /** Manually reset the circuit breaker (e.g., after human intervention) */
    reset(): void {
        this.lifetimeFailures = 0;
        this.circuitOpen = false;
        console.log(`[retry_handler] ${this.connectorName} circuit breaker RESET.`);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
