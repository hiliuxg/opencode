import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { TextField } from "@opencode-ai/ui/text-field"
import { useParams } from "@solidjs/router"
import { createResource, Show, createMemo, createSignal, createEffect } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { decode64 } from "@/utils/base64"

const PROVIDER_ID = "tme-conv1-provider"
const PROVIDER_ID2 = "tme-conv2-provider"
const MODEL_NAME = "GPT-5.4"

const DEFAULT_CONFIG_TEMPLATE = `{
    "$schema": "https://opencode.ai/config.json",
    "model": "tme-conv1-provider/GPT-5.4",
    "provider": {
        "tme-conv1-provider": {
            "npm": "@ai-sdk/github-copilot",
            "name": "tme-conv1",
            "options": {
                "baseURL": "https://continue.tmeoa.com/open/xcode/v1",
                "apiKey": "{{TOKEN}}"
            },
            "models": {
                "Claude-Haiku-4.5(速度快)": {
                    "name": "Claude-Haiku-4.5(速度快)"
                },
                "Claude-Sonnet-4.5": {
                    "name": "Claude-Sonnet-4.5",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                },
                "Claude-Sonnet-4.6": {
                    "name": "Claude-Sonnet-4.6",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                }
                "GPT-5-mini": {
                    "name": "GPT-5-mini"
                },
                "GPT-5.1": {
                    "name": "GPT-5.1",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                },
                "GPT-5.2": {
                    "name": "GPT-5.2",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                },
                "GPT-5.4-nano": {
                    "name": "GPT-5.4-nano",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                },
                "GPT-5.4": {
                    "name": "GPT-5.4",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                },
                "Gemini-3-Flash": {
                    "name": "Gemini-3-Flash",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                },
                "Gemini-3.1-Pro": {
                    "name": "Gemini-3.1-Pro",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                },
                "TME DeepSeek-V3.1-Terminus": {
                    "name": "TME DeepSeek-V3.1-Terminus"
                },
                "TME DeepSeek-V3.2": {
                    "name": "TME DeepSeek-V3.2"
                }
            }
        },
        "tme-conv2-provider": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "tme-conv2",
            "options": {
                "baseURL": "https://continue.tmeoa.com/open/xcode/v1",
                "apiKey": "{{TOKEN}}"
            },
            "models": {
                "DeepSeek-V3.2": {
                    "name": "DeepSeek-V3.2"
                },
                "GLM-4.7": {
                    "name": "GLM-4.7"
                },
                "GLM-5.1": {
                    "name": "GLM-5.1"
                },
                "GLM-5": {
                    "name": "GLM-5"
                },
                "Kimi-K2.5": {
                    "name": "Kimi-K2.5",
                    "modalities": {
                        "input": [
                            "text",
                            "image",
                            "pdf"
                        ],
                        "output": [
                            "text"
                        ]
                    }
                }
            }
        }
    }
}`

export const SettingsTokenManagement = () => {
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const params = useParams()
  const currentDir = () => decode64(params.dir)
  const [tokenInput, setTokenInput] = createSignal("")
  const [isSaving, setIsSaving] = createSignal(false)

  const [configData, { refetch }] = createResource(async () => {
    const dir = currentDir()
    if (!dir) {
      return { exists: false, token: "" }
    }

    try {
      // Check if opencode.json exists by listing root directory
      const listResponse = await sdk.client.file.list({ directory: dir, path: "" })
      const files = listResponse.data ?? []
      const configFile = files.find((f) => f.name === "opencode.json")

      if (!configFile) {
        return { exists: false, token: "" }
      }

      // Read opencode.json content
      const readResponse = await sdk.client.file.read({ directory: dir, path: "opencode.json" })
      const content = readResponse.data?.content ?? ""

      if (!content) {
        return { exists: true, token: "" }
      }

      // Parse JSON content and extract tme-continue-provider apiKey
      const config = JSON.parse(content)
      const provider = config.provider?.[PROVIDER_ID]
      const token = provider?.options?.apiKey ?? ""

      return { exists: true, token }
    } catch {
      return { exists: false, token: "" }
    }
  })

  // Fill input with existing token when data loads
  createEffect(() => {
    const data = configData()
    if (data?.exists && data.token) {
      setTokenInput(data.token)
    }
  })

  const configExists = createMemo(() => {
    return configData()?.exists ?? false
  })

  const existingToken = createMemo(() => {
    return configData()?.token ?? ""
  })

  const regenerateToken = () => {
    window.open("https://tmeaicoding.tmeoa.com/token", "_blank")
  }

  const handleSaveToken = async () => {
    const token = tokenInput().trim()
    if (!token) {
      showToast({
        title: language.t("common.error.title"),
        description: language.t("settings.tokenManagement.tokenRequired"),
      })
      return
    }

    const dir = currentDir()
    if (!dir) {
      showToast({
        title: language.t("common.error.title"),
        description: language.t("settings.tokenManagement.noDirectory"),
      })
      return
    }

    setIsSaving(true)
    try {
      let configContent: string

      if (configExists()) {
        // Update existing config - read, modify, and write back
        try {
          const readResponse = await sdk.client.file.read({ directory: dir, path: "opencode.json" })
          const existingContent = readResponse.data?.content ?? ""

          if (existingContent) {
            const config = JSON.parse(existingContent)

            // Ensure provider structure exists
            if (!config.provider) {
              config.provider = {}
            }

            if (!config.provider[PROVIDER_ID]) {
              // Provider doesn't exist, use template
              configContent = DEFAULT_CONFIG_TEMPLATE.replace(/\{\{TOKEN\}\}/g, token)
            } else {
              // Update existing provider's apiKey
              if (!config.provider[PROVIDER_ID].options) {
                config.provider[PROVIDER_ID].options = {}
              }
              config.provider[PROVIDER_ID].options.apiKey = token

              // Also update tme-conv2-provider apiKey if it exists
              if (config.provider[PROVIDER_ID2]) {
                if (!config.provider[PROVIDER_ID2].options) {
                  config.provider[PROVIDER_ID2].options = {}
                }
                config.provider[PROVIDER_ID2].options.apiKey = token
              }

              // Also update model if not set
              if (!config.model || !config.model.includes(PROVIDER_ID)) {
                config.model = `${PROVIDER_ID}/${MODEL_NAME}`
              }

              configContent = JSON.stringify(config, null, 4)
            }
          } else {
            configContent = DEFAULT_CONFIG_TEMPLATE.replace(/\{\{TOKEN\}\}/g, token)
          }
        } catch {
          // If read/parse fails, use template
          configContent = DEFAULT_CONFIG_TEMPLATE.replace(/\{\{TOKEN\}\}/g, token)
        }
      } else {
        // Create new config from template
        configContent = DEFAULT_CONFIG_TEMPLATE.replace(/\{\{TOKEN\}\}/g, token)
      }

      // Write to opencode.json using PUT /file/content
      await sdk.client.file.write({
        directory: dir,
        path: "opencode.json",
        content: configContent,
      })

      await sdk.client.instance.dispose({ directory: dir }).catch(() => undefined)

      showToast({
        title: configExists()
          ? language.t("settings.tokenManagement.updateSuccess")
          : language.t("settings.tokenManagement.saveSuccess"),
      })

      // Refresh data
      await refetch()
    } catch (err: any) {
      showToast({
        title: language.t("common.error.title"),
        description: err?.message || language.t("settings.tokenManagement.saveFailed"),
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">
            {language.t("settings.tokenManagement.title")}
          </h2>
          <p class="text-14-regular text-text-weak">
            {language.t("settings.tokenManagement.description")}
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-6 max-w-[720px]">
        <Show
          when={!configData.loading}
          fallback={
            <div class="flex items-center justify-center py-12">
              <span class="text-14-regular text-text-weak">
                {language.t("common.loading")}{language.t("common.loading.ellipsis")}
              </span>
            </div>
          }
        >
          <div class="flex flex-col gap-6 py-4">
            {/* Guide Section - Always visible */}
            <div class="flex flex-col gap-4 p-5 bg-surface-raised-base rounded-lg border border-border-weak-base">
              <h3 class="text-14-medium text-text-strong">
                {language.t("settings.tokenManagement.setupGuide")}
              </h3>
              <ol class="flex flex-col gap-3 text-14-regular text-text-base list-decimal list-inside">
                <li>
                  <span class="text-text-strong">
                    {language.t("settings.tokenManagement.step1")}{" "}
                  </span>
                  <button
                    onClick={regenerateToken}
                    class="text-13-medium text-interactive-base hover:text-interactive-hover underline"
                  >
                    https://tmeaicoding.tmeoa.com/token
                  </button>
                </li>
                <li>{language.t("settings.tokenManagement.step2")}</li>
                <li>{language.t("settings.tokenManagement.step3")}</li>
              </ol>
            </div>

            {/* Token Input Section - Always visible */}
            <div class="flex flex-col gap-3">
              <TextField
                label={language.t("settings.tokenManagement.inputLabel")}
                value={tokenInput()}
                onChange={setTokenInput}
                placeholder={language.t("settings.tokenManagement.inputPlaceholder")}
              />
              <div class="flex items-center justify-end gap-2">
                <Button
                  variant="primary"
                  icon={isSaving() ? undefined : "check"}
                  onClick={handleSaveToken}
                  disabled={isSaving() || !tokenInput().trim()}
                >
                  {isSaving() ? (
                    <>
                      <span class="size-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      {language.t("common.saving")}
                    </>
                  ) : (
                    language.t("common.save")
                  )}
                </Button>
              </div>
            </div>

            {/* Status indicator */}
            <Show when={configExists()}>
              <div class="flex items-center gap-2 text-13-regular text-text-weak">
                <Icon name="check" class="size-4 text-positive-base" />
                <span>
                  {existingToken()
                    ? language.t("settings.tokenManagement.status.configured")
                    : language.t("settings.tokenManagement.status.empty")}
                </span>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
