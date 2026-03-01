/**
 * Guided Topics Generation (Cron Job)
 *
 * Scheduled daily at 3AM Asia/Shanghai time.
 * For each configured skill, sends a prompt to the opencode server,
 * parses the NDJSON stream response, extracts JSON questions, and
 * stores them in the guided_topics MySQL table.
 */

import { Cron } from "croner"
import { getDb, schema } from "../db/client"
import { Config } from "../config"
import { Log } from "../util/log"

const log = Log.create({ service: "guided-topics-cron" })

// ---------------------------------------------------------------------------
// Prompt Template
// ---------------------------------------------------------------------------

const PROMPT_TEMPLATE = `你是一个专业的数据分析AI助手。你的任务是为技能 "{{skill_name}}" 生成3个引导性问题。

### 任务要求：
1. 请先加载 "{{skill_name}}" 技能，并读取分析对应 reference 目录下的相关文件。
2. 结合文件中的 metric（指标）信息以及分析模板等内容。
3. 为该技能生成3个具有代表性的引导问题，用于提示用户在一个新的会话中进行该数据分析领域的提问。
4. 引导问题中**必须**包含明确的日期范围（例如：昨日、最近一周等），并且需要关联到一个或多个具体的指标情况。例如："请帮我查一下最近一周的新增用户数和活跃用户数趋势"。
5. 返回格式必须是纯JSON格式，请确保可以直接被 JSON.parse 解析。

### JSON 返回格式：
{
  "questions": [
    "问题1",
    "问题2",
    "问题3"
  ]
}`

function buildPrompt(skillName: string): string {
    return PROMPT_TEMPLATE.replace(/{{skill_name}}/g, skillName)
}

// ---------------------------------------------------------------------------
// OpenCode API helpers
// ---------------------------------------------------------------------------

interface SessionResponse {
    id: string
    slug: string
    directory: string
}

async function createSession(host: string, directory: string): Promise<string> {
    const url = `${host}/session?directory=${encodeURIComponent(directory)}`
    const res = await fetch(url, { method: "POST" })
    if (!res.ok) {
        throw new Error(`Failed to create session: ${res.status} ${res.statusText}`)
    }
    const data = await res.json() as SessionResponse
    return data.id
}

/**
 * Send a prompt to the session and collect the full NDJSON response stream.
 * Returns the `text` parts combined.
 */
async function sendPromptAndWait(
    host: string,
    directory: string,
    sessionId: string,
    prompt: string
): Promise<string> {
    const url = `${host}/session/${sessionId}/message?directory=${encodeURIComponent(directory)}`
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: prompt }] }),
    })
    if (!res.ok) {
        throw new Error(`Failed to send prompt: ${res.status} ${res.statusText}`)
    }
    // The endpoint returns NDJSON (newline-delimited JSON) streaming objects
    const raw = await res.text()
    return raw
}

/**
 * Parse NDJSON lines, pick parts with type="text", and extract JSON content.
 */
function extractQuestionsFromNdjson(ndjson: string): string[] {
    const lines = ndjson.split("\n").filter(l => l.trim())
    let combinedText = ""

    for (const line of lines) {
        try {
            const obj = JSON.parse(line)
            // The top-level response has "parts" array
            if (obj.parts && Array.isArray(obj.parts)) {
                for (const part of obj.parts) {
                    if (part.type === "text" && typeof part.text === "string") {
                        combinedText += part.text
                    }
                }
            }
            // Sometimes individual part objects are emitted
            if (obj.type === "text" && typeof obj.text === "string") {
                combinedText += obj.text
            }
        } catch {
            // skip non-json lines
        }
    }

    // Extract JSON from possible markdown code block (```json ... ```)
    const jsonMatch = combinedText.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : combinedText.trim()

    try {
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed.questions)) {
            return parsed.questions.filter((q: any) => typeof q === "string" && q.trim())
        }
    } catch (e) {
        log.error(`Failed to parse questions JSON: ${e}`, { raw: jsonStr })
    }
    return []
}

// ---------------------------------------------------------------------------
// Core generation logic
// ---------------------------------------------------------------------------

export async function generateTopicsForSkill(skillName: string): Promise<void> {
    const { opencodeHost, directory } = Config.guidedTopics
    log.info(`Generating topics for skill: ${skillName}`)

    const sessionId = await createSession(opencodeHost, directory)
    log.info(`Created session: ${sessionId}`)

    const prompt = buildPrompt(skillName)
    const ndjson = await sendPromptAndWait(opencodeHost, directory, sessionId, prompt)

    const questions = extractQuestionsFromNdjson(ndjson)
    log.info(`Extracted ${questions.length} questions for skill: ${skillName}`, { questions })

    if (questions.length === 0) {
        log.warn(`No questions extracted for skill: ${skillName}`)
        return
    }

    const db = getDb()
    for (const question of questions) {
        await db.insert(schema.guidedTopics).values({
            skillname: skillName,
            question,
        } as any)
    }
    log.info(`Saved ${questions.length} topic(s) for skill: ${skillName}`)
}

export async function runGuidedTopicsGeneration(): Promise<void> {
    const { skillNames } = Config.guidedTopics
    if (skillNames.length === 0) {
        log.warn("No skill names configured for guided topics generation. Set GUIDED_TOPIC_SKILLS env var.")
        return
    }

    log.info(`Starting guided topics generation for ${skillNames.length} skill(s): ${skillNames.join(", ")}`)
    for (const skillName of skillNames) {
        try {
            await generateTopicsForSkill(skillName)
        } catch (err: any) {
            log.error(`Failed to generate topics for skill '${skillName}':`, { error: err?.message })
        }
    }
    log.info("Guided topics generation complete.")
}

// ---------------------------------------------------------------------------
// Cron Job Scheduling
// ---------------------------------------------------------------------------

let guidedTopicsCron: Cron | null = null

export function startGuidedTopicsCron(): void {
    const { cronExpression, timezone } = Config.guidedTopics
    log.info(`Scheduling guided topics cron: "${cronExpression}" tz=${timezone}`)

    guidedTopicsCron = new Cron(cronExpression, { timezone }, async () => {
        log.info("Guided topics cron triggered.")
        try {
            await runGuidedTopicsGeneration()
        } catch (err: any) {
            log.error("Guided topics cron job error:", { error: err?.message })
        }
    })
}

export function stopGuidedTopicsCron(): void {
    guidedTopicsCron?.stop()
    guidedTopicsCron = null
}
