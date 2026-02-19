import { Cron } from "croner"

import { getDb, schema } from "../db/client"
import { eq } from "drizzle-orm"

export class CronEngine {
    private jobs = new Map<string, Cron>()
    private onTrigger?: (jobId: string) => void

    /**
     * Set a callback that fires when a cron job triggers.
     * The executor layer plugs in here.
     */
    setTriggerHandler(handler: (jobId: string) => void) {
        this.onTrigger = handler
    }

    /** Load all enabled jobs from DB and schedule them */
    async bootstrap() {
        const db = getDb()
        const jobs = await db
            .select()
            .from(schema.cronJobs)
            .where(eq(schema.cronJobs.enabled, true))

        console.log(`[CronEngine] bootstrapping ${jobs.length} enabled job(s)`)
        for (const job of jobs) {
            this.schedule(job.id, job.cronExpression, job.timezone ?? "UTC")
        }
    }

    /** Schedule (or reschedule) a single job */
    schedule(jobId: string, cronExpression: string, timezone: string) {
        this.unschedule(jobId)
        try {
            const task = new Cron(cronExpression, { timezone }, () => {
                console.log(`[CronEngine] triggered job=${jobId}`)
                this.onTrigger?.(jobId)
            })
            this.jobs.set(jobId, task)
            console.log(`[CronEngine] scheduled job=${jobId} cron="${cronExpression}" tz=${timezone}`)
        } catch (err) {
            console.error(`[CronEngine] failed to schedule job=${jobId}:`, err)
        }
    }

    /** Remove a job from the scheduler */
    unschedule(jobId: string) {
        const existing = this.jobs.get(jobId)
        if (existing) {
            existing.stop()
            this.jobs.delete(jobId)
        }
    }

    /** Get the next scheduled run time for a job */
    nextRun(jobId: string): Date | null {
        const cron = this.jobs.get(jobId)
        return cron?.nextRun() ?? null
    }

    /** Stop all scheduled jobs */
    stopAll() {
        for (const [id, cron] of this.jobs) {
            cron.stop()
        }
        this.jobs.clear()
        console.log("[CronEngine] all jobs stopped")
    }

    /** Number of actively scheduled jobs */
    get size() {
        return this.jobs.size
    }
}

/** Singleton instance */
export const cronEngine = new CronEngine()
