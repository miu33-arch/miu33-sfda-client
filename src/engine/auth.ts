import { z } from "zod";

export const SovereignAuthConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  tokenEndpoint: z.string().url(),
  scope: z.string().default("sfda.clearance.write"),
  clientCertPem: z.string().optional(), // For mTLS handshakes
  clientKeyPem: z.string().optional(),
});

export type SovereignAuthConfig = z.infer<typeof SovereignAuthConfigSchema>;

export interface CachedToken {
  accessToken: string;
  expiresAtEpochMs: number;
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class SovereignHttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public responseBody: string
  ) {
    super(`[Sovereign Gateway Error] HTTP ${status} ${statusText}: ${responseBody}`);
    this.name = "SovereignHttpError";
  }
}

export class SovereignAuthManager {
  private tokenCache: CachedToken | null = null;

  constructor(private config: SovereignAuthConfig) {
    SovereignAuthConfigSchema.parse(config);
  }

  /**
   * Retrieves a valid Bearer token, auto-refreshing if within 60s of expiration
   */
  public async getValidToken(): Promise<string> {
    const now = Date.now();
    const safetyBufferMs = 60 * 1000; // 60s skew margin

    if (this.tokenCache && this.tokenCache.expiresAtEpochMs - safetyBufferMs > now) {
      return this.tokenCache.accessToken;
    }

    return await this.refreshToken();
  }

  private async refreshToken(): Promise<string> {
    const bodyParams = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope,
    });

    const response = await fetch(this.config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new SovereignHttpError(response.status, response.statusText, errText);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAtEpochMs: Date.now() + (data.expires_in * 1000),
    };

    return this.tokenCache.accessToken;
  }

  /**
   * Executes network calls against sovereign endpoints with exponential backoff & full jitter
   */
  public static async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 4;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 10000;

    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        return await operation();
      } catch (err: unknown) {
        attempt++;
        const isTransient = this.isTransientError(err);

        if (attempt > maxRetries || !isTransient) {
          throw err;
        }

        // Exponential backoff with randomized full jitter
        const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        const jitterDelay = Math.floor(Math.random() * exponentialDelay);

        await new Promise((resolve) => setTimeout(resolve, jitterDelay));
      }
    }

    throw new Error("Sovereign execution retry limits exceeded.");
  }

  private static isTransientError(err: unknown): boolean {
    if (err instanceof SovereignHttpError) {
      // 429 Too Many Requests, 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout
      return [429, 502, 503, 504].includes(err.status);
    }
    if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
      return true; // Network socket disconnect or DNS blip
    }
    return false;
  }
}