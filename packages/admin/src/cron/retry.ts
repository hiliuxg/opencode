/**
 * Retry utility with exponential backoff.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { maxRetries: number; baseDelay?: number; label?: string }
): Promise<T> {
    const baseDelay = opts.baseDelay ?? 1000
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn()
        } catch (err) {
            if (attempt === opts.maxRetries) {
                console.error(`[retry] ${opts.label ?? "task"} failed after ${attempt + 1} attempt(s)`)
                throw err
            }
            const delay = baseDelay * Math.pow(2, attempt)
            console.warn(
                `[retry] ${opts.label ?? "task"} attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
                err instanceof Error ? err.message : err
            )
            await new Promise((r) => setTimeout(r, delay))
        }
    }
    throw new Error("unreachable")
}
