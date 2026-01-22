import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, differenceInDays, parseISO } from 'date-fns';

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Format date to readable string
 */
export function formatDate(date: string | Date, formatStr = 'MMM d, yyyy'): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, formatStr);
}

/**
 * Format date to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return formatDistanceToNow(dateObj, { addSuffix: true });
}

/**
 * Get days until a given date
 */
export function getDaysUntil(date: string | Date): number {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return differenceInDays(dateObj, new Date());
}

/**
 * Get days since a given date
 */
export function getDaysSince(date: string | Date): number {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return differenceInDays(new Date(), dateObj);
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return `${str.slice(0, length)}...`;
}

/**
 * Capitalize first letter
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Generate a random ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Check if a value is empty (null, undefined, empty string, empty array, empty object)
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a size string (e.g., "1.5 GB") to bytes
 */
export function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(bytes?|kb|mb|gb|tb|pb)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    byte: 1,
    bytes: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
    pb: 1024 ** 5,
  };

  return value * (multipliers[unit] || 1);
}

/**
 * Convert API/network errors to user-friendly messages
 */
export function getUserFriendlyMessage(error: Error): string {
  const message = error.message.toLowerCase();

  // Network errors
  if (
    message.includes('network error') ||
    message.includes('econnrefused') ||
    message.includes('failed to fetch') ||
    message.includes('net::err_')
  ) {
    return 'Unable to connect to the server. Please check your connection.';
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'The request took too long. Please try again.';
  }

  // HTTP status code errors
  if (message.includes('401') || message.includes('unauthorized')) {
    return 'You don\'t have permission to perform this action.';
  }

  if (message.includes('403') || message.includes('forbidden')) {
    return 'You don\'t have permission to perform this action.';
  }

  if (message.includes('404') || message.includes('not found')) {
    return 'The requested resource was not found.';
  }

  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('internal server error') ||
    message.includes('bad gateway') ||
    message.includes('service unavailable')
  ) {
    return 'The server encountered an error. Please try again later.';
  }

  // Clean up technical jargon from the error message
  // Remove stack traces, file paths, and technical details
  let cleanMessage = error.message;

  // Remove common technical prefixes
  cleanMessage = cleanMessage.replace(/^(Error|TypeError|ReferenceError|SyntaxError):\s*/i, '');

  // Remove file paths
  cleanMessage = cleanMessage.replace(/\s*at\s+.*$/gm, '');

  // If the message is still reasonable length and doesn't look too technical, use it
  if (cleanMessage.length > 0 && cleanMessage.length <= 150 && !cleanMessage.includes('undefined')) {
    return cleanMessage;
  }

  // Fallback for truly incomprehensible errors
  return 'An unexpected error occurred. Please try again.';
}
