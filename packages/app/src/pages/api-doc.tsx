import { createMemo, createSignal, createResource, For, Show, type JSX } from "solid-js"
import { File } from "@opencode-ai/ui/file"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"

// ─── Shared Components ───

function CodeBlock(props: { code: string; name: string }) {
    const [copied, setCopied] = createSignal(false)

    const file = createMemo(() => ({
        name: props.name,
        contents: props.code,
        cacheKey: props.name,
    }))

    const handleCopy = async () => {
        await navigator.clipboard.writeText(props.code)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div class="relative group border border-border-base rounded-md overflow-hidden my-2">
            <File mode="text" file={file()} overflow="wrap" class="select-text bg-background-base" />
            <div class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Tooltip placement="left" value={copied() ? "Copied!" : "Copy"}>
                    <IconButton
                        icon={copied() ? "check" : "copy"}
                        variant="ghost"
                        size="small"
                        onClick={handleCopy}
                    />
                </Tooltip>
            </div>
        </div>
    )
}

function Step(props: { title: string; children: JSX.Element }) {
    return (
        <div class="flex flex-col mb-4">
            <div class="text-14-medium text-text-strong mb-1">{props.title}</div>
            {props.children}
        </div>
    )
}

// ─── Method Badge ───

const METHOD_COLORS: Record<string, string> = {
    get: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    post: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    put: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    patch: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    delete: "bg-red-500/15 text-red-400 border-red-500/30",
}

function MethodBadge(props: { method: string }) {
    const color = () => METHOD_COLORS[props.method] ?? "bg-surface-base text-text-base"
    return (
        <span class={`inline-block px-2 py-0.5 rounded text-11-medium uppercase border font-mono ${color()}`}>
            {props.method}
        </span>
    )
}

// ─── Schema Renderer ───

function renderSchemaType(schema: any, schemas: Record<string, any>): string {
    if (!schema) return "unknown"
    if (schema.$ref) {
        const name = schema.$ref.replace("#/components/schemas/", "")
        return name
    }
    if (schema.anyOf) {
        return schema.anyOf.map((s: any) => renderSchemaType(s, schemas)).join(" | ")
    }
    if (schema.type === "array") {
        const items = schema.items ? renderSchemaType(schema.items, schemas) : "any"
        return `${items}[]`
    }
    if (schema.type === "object" && schema.properties) {
        const props = Object.entries(schema.properties).map(
            ([key, val]: [string, any]) => `${key}: ${renderSchemaType(val, schemas)}`
        )
        return `{ ${props.join(", ")} }`
    }
    if (schema.const !== undefined) return JSON.stringify(schema.const)
    return schema.type ?? "any"
}

// ─── Endpoint Card ───

interface EndpointInfo {
    method: string
    path: string
    summary: string
    description: string
    operationId: string
    requestBody?: any
    parameters?: any[]
    responses: Record<string, any>
}

function EndpointCard(props: { endpoint: EndpointInfo; schemas: Record<string, any> }) {
    const [expanded, setExpanded] = createSignal(false)
    const ep = () => props.endpoint

    const responseSchema = createMemo(() => {
        const res200 = ep().responses?.["200"] ?? ep().responses?.["204"]
        if (!res200?.content) return null
        const ct = res200.content["application/json"] ?? res200.content["text/event-stream"]
        return ct?.schema ?? null
    })

    const requestSchema = createMemo(() => {
        const body = ep().requestBody
        if (!body?.content) return null
        return body.content["application/json"]?.schema ?? null
    })

    const params = createMemo(() => ep().parameters ?? [])

    return (
        <div class="border border-border-base rounded-md overflow-hidden">
            <button
                class="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-base transition-colors text-left cursor-pointer"
                onClick={() => setExpanded(!expanded())}
            >
                <MethodBadge method={ep().method} />
                <code class="text-13-medium text-text-strong font-mono flex-1 truncate">{ep().path}</code>
                <span class="text-12-regular text-text-weak truncate max-w-[40%]">{ep().summary}</span>
                <Icon
                    name="chevron-grabber-vertical"
                    size="small"
                    class="shrink-0 text-text-weak"
                />
            </button>

            <Show when={expanded()}>
                <div class="border-t border-border-base px-4 py-3 flex flex-col gap-3 bg-background-base">
                    <Show when={ep().description}>
                        <p class="text-13-regular text-text-base">{ep().description}</p>
                    </Show>

                    <Show when={params().length > 0}>
                        <div>
                            <div class="text-12-medium text-text-weak mb-1">Parameters</div>
                            <div class="border border-border-base rounded-md overflow-hidden">
                                <table class="w-full text-12-regular">
                                    <thead>
                                        <tr class="bg-surface-base">
                                            <th class="text-left px-3 py-1.5 text-text-weak font-medium">Name</th>
                                            <th class="text-left px-3 py-1.5 text-text-weak font-medium">In</th>
                                            <th class="text-left px-3 py-1.5 text-text-weak font-medium">Type</th>
                                            <th class="text-left px-3 py-1.5 text-text-weak font-medium">Required</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <For each={params()}>
                                            {(param: any) => (
                                                <tr class="border-t border-border-base">
                                                    <td class="px-3 py-1.5 font-mono text-text-strong">{param.name}</td>
                                                    <td class="px-3 py-1.5 text-text-base">{param.in}</td>
                                                    <td class="px-3 py-1.5 font-mono text-text-base">
                                                        {param.schema ? renderSchemaType(param.schema, props.schemas) : "string"}
                                                    </td>
                                                    <td class="px-3 py-1.5 text-text-base">{param.required ? "✓" : ""}</td>
                                                </tr>
                                            )}
                                        </For>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </Show>

                    <Show when={requestSchema()}>
                        <div>
                            <div class="text-12-medium text-text-weak mb-1">Request Body</div>
                            <code class="text-12-regular text-text-base font-mono bg-surface-base px-2 py-1 rounded">
                                {renderSchemaType(requestSchema(), props.schemas)}
                            </code>
                        </div>
                    </Show>

                    <Show when={responseSchema()}>
                        <div>
                            <div class="text-12-medium text-text-weak mb-1">Response</div>
                            <code class="text-12-regular text-text-base font-mono bg-surface-base px-2 py-1 rounded">
                                {renderSchemaType(responseSchema(), props.schemas)}
                            </code>
                        </div>
                    </Show>
                </div>
            </Show>
        </div>
    )
}

// ─── API Group ───

interface ApiGroup {
    name: string
    endpoints: EndpointInfo[]
}

function groupEndpoints(paths: Record<string, any>): ApiGroup[] {
    const groups: Record<string, EndpointInfo[]> = {}

    for (const [path, methods] of Object.entries(paths)) {
        for (const [method, detail] of Object.entries(methods as Record<string, any>)) {
            const segment = path.split("/").filter(Boolean)[0] ?? "other"
            const groupName = segment.charAt(0).toUpperCase() + segment.slice(1)

            if (!groups[groupName]) groups[groupName] = []
            groups[groupName].push({
                method,
                path,
                summary: detail.summary ?? "",
                description: detail.description ?? "",
                operationId: detail.operationId ?? "",
                requestBody: detail.requestBody,
                parameters: detail.parameters,
                responses: detail.responses ?? {},
            })
        }
    }

    return Object.entries(groups).map(([name, endpoints]) => ({ name, endpoints }))
}

// ─── Main Page ───

export default function ApiDoc() {
    const language = useLanguage()
    const server = useServer()
    const params = useParams()
    const currentDir = () => decode64(params.dir)

    const [spec] = createResource(async () => {
        const url = server.current?.http.url
        if (!url) throw new Error("No server URL")
        const res = await fetch(`${url}/doc`)
        return res.json()
    })

    const groups = createMemo(() => {
        const s = spec()
        if (!s?.paths) return []
        return groupEndpoints(s.paths)
    })

    const schemas = createMemo(() => spec()?.components?.schemas ?? {})

    return (
        <div class="size-full overflow-y-auto select-text">
            <div class="max-w-3xl mx-auto px-6 py-8">
                {/* Quick Start */}
                <h1 class="text-20-medium text-text-strong mb-6">{language.t("apiDoc.title")}</h1>

                <Step title={language.t("apiDoc.step1.title")}>
                    <CodeBlock code={`export OPENCODE_HOST="${server.current?.http.url ?? ""}"\nexport OPENCODE_DIR="${currentDir() || "/your/workspace/path"}"`} name="env.sh" />
                </Step>
                <Step title={language.t("apiDoc.step2.title")}>
                    <CodeBlock
                        code={`curl -X POST "$OPENCODE_HOST/session?directory=$OPENCODE_DIR"`}
                        name="session.sh"
                    />
                </Step>
                <Step title={language.t("apiDoc.step3.title")}>
                    <CodeBlock
                        code={`curl -X POST "$OPENCODE_HOST/session/<session_id>/message?directory=$OPENCODE_DIR" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "parts": [{"type": "text", "text": "how are you today?"}]\n  }'`}
                        name="message.sh"
                    />
                    <div class="text-12-regular text-text-weak mt-1">
                        {language.t("apiDoc.step3.hint")}
                    </div>
                </Step>
                <Step title={language.t("apiDoc.step4.title")}>
                    <CodeBlock
                        code={`${server.current?.http.url ?? ""}/${params.dir}/session/<session_id>`}
                        name="url.txt"
                    />
                    <div class="text-12-regular text-text-weak mt-1">
                        {language.t("apiDoc.step4.hint")}
                    </div>
                </Step>

                {/* API Reference */}
                <div class="mt-10 border-t border-border-base pt-8">
                    <h2 class="text-18-medium text-text-strong mb-6">API Reference</h2>

                    <Show when={spec.loading}>
                        <div class="text-14-regular text-text-weak py-8 text-center">Loading API spec...</div>
                    </Show>

                    <Show when={spec.error}>
                        <div class="text-14-regular text-red-400 py-4">Failed to load API spec.</div>
                    </Show>

                    <Show when={!spec.loading && !spec.error}>
                        <div class="flex flex-col gap-6">
                            <For each={groups()}>
                                {(group) => (
                                    <div>
                                        <h3 class="text-14-medium text-text-strong mb-2">{group.name}</h3>
                                        <div class="flex flex-col gap-1.5">
                                            <For each={group.endpoints}>
                                                {(endpoint) => (
                                                    <EndpointCard endpoint={endpoint} schemas={schemas()} />
                                                )}
                                            </For>
                                        </div>
                                    </div>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>
            </div>
        </div>
    )
}
