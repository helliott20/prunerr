import cron, { ScheduledTask } from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import logger from '../utils/logger';
import {
  scanLibraries,
  processDeletionQueue,
  sendDeletionReminders,
  getTask,
  getAvailableTasks,
  type TaskResult,
  type TaskFunction,
} from './tasks';

// ============================================================================
// Scheduler Configuration
// ============================================================================

export interface SchedulerConfig {
  enabledTasks: string[];
  schedules: {
    scanLibraries: string;
    processDeletionQueue: string;
    sendDeletionReminders: string;
  };
  timezone: string;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  enabledTasks: ['scanLibraries', 'processDeletionQueue', 'sendDeletionReminders'],
  schedules: {
    scanLibraries: '0 3 * * *', // Daily at 3 AM
    processDeletionQueue: '0 4 * * *', // Daily at 4 AM
    sendDeletionReminders: '0 9 * * *', // Daily at 9 AM
  },
  timezone: 'UTC',
};

// ============================================================================
// Job Status Types
// ============================================================================

export interface JobStatus {
  name: string;
  enabled: boolean;
  schedule: string;
  lastRun?: Date;
  lastResult?: TaskResult;
  nextRun?: Date;
  isRunning: boolean;
}

// ============================================================================
// Scheduler Class
// ============================================================================

/**
 * Scheduler for managing automated tasks using node-cron
 */
export class Scheduler {
  private config: SchedulerConfig;
  private jobs: Map<string, ScheduledTask> = new Map();
  private jobStatus: Map<string, JobStatus> = new Map();
  private isRunning: boolean = false;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize job status for all tasks
    for (const taskName of getAvailableTasks()) {
      const schedule = this.config.schedules[taskName as keyof typeof this.config.schedules] || '';
      this.jobStatus.set(taskName, {
        name: taskName,
        enabled: this.config.enabledTasks.includes(taskName),
        schedule,
        isRunning: false,
      });
    }
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Start all scheduled jobs
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    logger.info('Starting scheduler');

    // Schedule library scans
    if (this.config.enabledTasks.includes('scanLibraries')) {
      this.scheduleScans(this.config.schedules.scanLibraries);
    }

    // Schedule deletion processing
    if (this.config.enabledTasks.includes('processDeletionQueue')) {
      this.scheduleDeletionProcessing(this.config.schedules.processDeletionQueue);
    }

    // Schedule deletion reminders
    if (this.config.enabledTasks.includes('sendDeletionReminders')) {
      this.scheduleJob('sendDeletionReminders', this.config.schedules.sendDeletionReminders, sendDeletionReminders);
    }

    this.isRunning = true;
    logger.info(`Scheduler started with ${this.jobs.size} scheduled jobs`);
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    if (!this.isRunning) {
      logger.warn('Scheduler is not running');
      return;
    }

    logger.info('Stopping scheduler');

    for (const [name, job] of this.jobs) {
      job.stop();
      logger.debug(`Stopped job: ${name}`);
    }

    this.jobs.clear();
    this.isRunning = false;

    logger.info('Scheduler stopped');
  }

  /**
   * Restart the scheduler with new configuration
   */
  restart(config?: Partial<SchedulerConfig>): void {
    this.stop();

    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.start();
  }

  // ============================================================================
  // Scheduling Methods
  // ============================================================================

  /**
   * Schedule library scans
   */
  scheduleScans(cronExpression: string): void {
    this.scheduleJob('scanLibraries', cronExpression, scanLibraries);
  }

  /**
   * Schedule deletion processing
   */
  scheduleDeletionProcessing(cronExpression: string): void {
    this.scheduleJob('processDeletionQueue', cronExpression, processDeletionQueue);
  }

  /**
   * Schedule a generic job
   */
  private scheduleJob(name: string, cronExpression: string, taskFn: TaskFunction): void {
    // Validate cron expression
    if (!cron.validate(cronExpression)) {
      logger.error(`Invalid cron expression for ${name}: ${cronExpression}`);
      return;
    }

    // Stop existing job if any
    if (this.jobs.has(name)) {
      this.jobs.get(name)?.stop();
      this.jobs.delete(name);
    }

    // Create the scheduled task
    const job = cron.schedule(
      cronExpression,
      async () => {
        await this.executeTask(name, taskFn);
      },
      {
        timezone: this.config.timezone,
      }
    );

    this.jobs.set(name, job);

    // Update job status
    const status = this.jobStatus.get(name);
    if (status) {
      status.enabled = true;
      status.schedule = cronExpression;
      status.nextRun = this.getNextRunTime(cronExpression);
    }

    logger.info(`Scheduled job "${name}" with cron: ${cronExpression}`);
  }

  /**
   * Execute a task and track its status
   */
  private async executeTask(name: string, taskFn: TaskFunction): Promise<TaskResult | null> {
    const status = this.jobStatus.get(name);

    if (status?.isRunning) {
      logger.warn(`Task "${name}" is already running, skipping this execution`);
      return null;
    }

    if (status) {
      status.isRunning = true;
      status.lastRun = new Date();
    }

    logger.info(`Executing scheduled task: ${name}`);

    try {
      const result = await taskFn();

      if (status) {
        status.isRunning = false;
        status.lastResult = result;
        status.nextRun = this.getNextRunTime(status.schedule);
      }

      if (result.success) {
        logger.info(`Task "${name}" completed successfully in ${result.durationMs}ms`);
      } else {
        logger.error(`Task "${name}" failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (status) {
        status.isRunning = false;
        status.lastResult = {
          success: false,
          taskName: name,
          startedAt: status.lastRun || new Date(),
          completedAt: new Date(),
          durationMs: 0,
          error: errorMessage,
        };
        status.nextRun = this.getNextRunTime(status.schedule);
      }

      logger.error(`Task "${name}" threw an exception:`, error);
      return null;
    }
  }

  // ============================================================================
  // Manual Execution
  // ============================================================================

  /**
   * Run a task immediately by name
   */
  async runNow(taskName: string): Promise<TaskResult> {
    logger.info(`Manual execution requested for task: ${taskName}`);

    const taskFn = getTask(taskName);

    if (!taskFn) {
      const error = `Unknown task: ${taskName}. Available tasks: ${getAvailableTasks().join(', ')}`;
      logger.error(error);
      throw new Error(error);
    }

    const result = await this.executeTask(taskName, taskFn);

    if (!result) {
      throw new Error(`Task "${taskName}" is currently running`);
    }

    return result;
  }

  /**
   * Run all scheduled tasks immediately
   */
  async runAllNow(): Promise<Map<string, TaskResult>> {
    const results = new Map<string, TaskResult>();

    for (const taskName of this.config.enabledTasks) {
      try {
        const result = await this.runNow(taskName);
        results.set(taskName, result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.set(taskName, {
          success: false,
          taskName,
          startedAt: new Date(),
          completedAt: new Date(),
          durationMs: 0,
          error: errorMessage,
        });
      }
    }

    return results;
  }

  // ============================================================================
  // Status & Information
  // ============================================================================

  /**
   * Get status of all scheduled jobs
   */
  getStatus(): JobStatus[] {
    return Array.from(this.jobStatus.values());
  }

  /**
   * Get status of a specific job
   */
  getJobStatus(name: string): JobStatus | undefined {
    return this.jobStatus.get(name);
  }

  /**
   * Check if the scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get current configuration
   */
  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  /**
   * Calculate next run time from cron expression using cron-parser
   */
  private getNextRunTime(cronExpression: string): Date | undefined {
    if (!cronExpression || !cron.validate(cronExpression)) {
      return undefined;
    }

    try {
      const options = {
        currentDate: new Date(),
        tz: this.config.timezone,
      };

      const interval = CronExpressionParser.parse(cronExpression, options);
      return interval.next().toDate();
    } catch (error) {
      logger.error('Failed to parse cron expression', { cronExpression, error });
      return undefined;
    }
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Enable a specific task
   */
  enableTask(taskName: string): void {
    if (!getTask(taskName)) {
      throw new Error(`Unknown task: ${taskName}`);
    }

    if (!this.config.enabledTasks.includes(taskName)) {
      this.config.enabledTasks.push(taskName);
    }

    const status = this.jobStatus.get(taskName);
    if (status) {
      status.enabled = true;
    }

    // If scheduler is running, schedule the task
    if (this.isRunning) {
      const schedule = this.config.schedules[taskName as keyof typeof this.config.schedules];
      const taskFn = getTask(taskName);
      if (schedule && taskFn) {
        this.scheduleJob(taskName, schedule, taskFn);
      }
    }

    logger.info(`Task "${taskName}" enabled`);
  }

  /**
   * Disable a specific task
   */
  disableTask(taskName: string): void {
    const index = this.config.enabledTasks.indexOf(taskName);
    if (index > -1) {
      this.config.enabledTasks.splice(index, 1);
    }

    const status = this.jobStatus.get(taskName);
    if (status) {
      status.enabled = false;
    }

    // Stop the job if running
    const job = this.jobs.get(taskName);
    if (job) {
      job.stop();
      this.jobs.delete(taskName);
    }

    logger.info(`Task "${taskName}" disabled`);
  }

  /**
   * Update schedule for a task
   */
  updateSchedule(taskName: string, cronExpression: string): void {
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    this.config.schedules[taskName as keyof typeof this.config.schedules] = cronExpression;

    const status = this.jobStatus.get(taskName);
    if (status) {
      status.schedule = cronExpression;
      status.nextRun = this.getNextRunTime(cronExpression);
    }

    // Reschedule if scheduler is running and task is enabled
    if (this.isRunning && this.config.enabledTasks.includes(taskName)) {
      const taskFn = getTask(taskName);
      if (taskFn) {
        this.scheduleJob(taskName, cronExpression, taskFn);
      }
    }

    logger.info(`Schedule updated for "${taskName}": ${cronExpression}`);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let schedulerInstance: Scheduler | null = null;

/**
 * Get the singleton scheduler instance
 */
export function getScheduler(): Scheduler {
  if (!schedulerInstance) {
    schedulerInstance = new Scheduler();
  }
  return schedulerInstance;
}

/**
 * Create a new scheduler instance with custom configuration
 */
export function createScheduler(config?: Partial<SchedulerConfig>): Scheduler {
  return new Scheduler(config);
}

export default Scheduler;
