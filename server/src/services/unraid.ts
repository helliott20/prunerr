import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';

// ============================================================================
// Unraid Types
// ============================================================================

export interface UnraidCapacity {
  kilobytes: {
    free: number;
    used: number;
    total: number;
  };
}

export interface UnraidDisk {
  id: string;
  name: string;
  size: number;
  temp: number | null;
  status: string;
  fsUsed: number | null;
  fsFree: number | null;
  fsSize: number | null;
}

export interface UnraidCache {
  id: string;
  name: string;
  size: number;
  temp: number | null;
  fsUsed: number | null;
  fsFree: number | null;
  fsSize: number | null;
}

export interface UnraidParity {
  id: string;
  name: string;
  size: number;
  temp: number | null;
  status: string;
}

export interface UnraidArray {
  state: string;
  capacity: UnraidCapacity;
  disks: UnraidDisk[];
  caches: UnraidCache[];
  parities: UnraidParity[];
}

export interface UnraidArrayStats {
  state: string;
  capacity: UnraidCapacity;
  disks: UnraidDisk[];
  caches: UnraidCache[];
  parities: UnraidParity[];
}

interface UnraidGraphQLResponse {
  data?: {
    array?: UnraidArray;
  };
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

// ============================================================================
// Unraid Service
// ============================================================================

export class UnraidService {
  private client: AxiosInstance;

  constructor(url: string, apiKey: string) {
    const baseUrl = url.replace(/\/$/, ''); // Remove trailing slash

    this.client = axios.create({
      baseURL: `${baseUrl}/graphql`,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] as string) || 5;
          logger.warn(`Unraid rate limited, retrying after ${retryAfter}s`);
          await this.delay(retryAfter * 1000);
          return this.client.request(error.config!);
        }
        throw error;
      }
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a GraphQL query
   */
  private async query<T>(graphqlQuery: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await this.client.post<UnraidGraphQLResponse>('', {
      query: graphqlQuery,
      variables,
    });

    if (response.data.errors && response.data.errors.length > 0) {
      const errorMessages = response.data.errors.map((e) => e.message).join(', ');
      throw new Error(`GraphQL errors: ${errorMessages}`);
    }

    return response.data.data as T;
  }

  /**
   * Test connection to Unraid
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.query<{ array: { state: string } }>(`
        query {
          array {
            state
          }
        }
      `);

      const isValid = !!result.array?.state;

      if (isValid) {
        logger.info('Unraid connection test successful', { state: result.array.state });
      }

      return isValid;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Unraid connection test failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Get array statistics including disk information
   */
  async getArrayStats(): Promise<UnraidArrayStats> {
    try {
      const result = await this.query<{ array: UnraidArray }>(`
        query {
          array {
            state
            capacity {
              kilobytes {
                free
                used
                total
              }
            }
            disks {
              id
              name
              size
              temp
              status
              fsUsed
              fsFree
              fsSize
            }
            caches {
              id
              name
              size
              temp
              fsUsed
              fsFree
              fsSize
            }
            parities {
              id
              name
              size
              temp
              status
            }
          }
        }
      `);

      logger.info('Retrieved Unraid array stats', {
        state: result.array.state,
        diskCount: result.array.disks.length,
        cacheCount: result.array.caches.length,
        parityCount: result.array.parities.length,
      });

      return result.array;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get Unraid array stats', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }
}

export default UnraidService;
