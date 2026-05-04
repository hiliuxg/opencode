import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { createPathHelpers } from "./file/path"
import {
  approxBytes,
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  hasFileContent,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
} from "./file/content-cache"
import { createFileViewCache } from "./file/view-cache"
import { createFileTreeStore } from "./file/tree-store"
import { invalidateFromWatcher } from "./file/watcher"
import {
  selectionFromLines,
  type FileState,
  type FileSelection,
  type FileViewState,
  type SelectedLineRange,
} from "./file/types"

export type { FileSelection, SelectedLineRange, FileViewState, FileState }
export { selectionFromLines }
export {
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useSDK()
    useSync()
    const params = useParams()
    const language = useLanguage()
    const layout = useLayout()

    const scope = createMemo(() => sdk.directory)
    const path = createPathHelpers(scope)
    const tabs = layout.tabs(() => `${params.dir}${params.id ? "/" + params.id : ""}`)

    const inflight = new Map<string, Promise<void>>()
    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

    const tree = createFileTreeStore({
      scope,
      normalizeDir: path.normalizeDir,
      list: (dir) => sdk.client.file.list({ path: dir }).then((x) => x.data ?? []),
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    const evictContent = (keep?: Set<string>) => {
      evictContentLru(keep, (target) => {
        if (!store.file[target]) return
        setStore(
          "file",
          target,
          produce((draft) => {
            draft.content = undefined
            draft.loaded = false
          }),
        )
      })
    }

    createEffect(() => {
      scope()
      inflight.clear()
      resetFileContentLru()
      batch(() => {
        setStore("file", reconcile({}))
        tree.reset()
      })
    })

    const viewCache = createFileViewCache()
    const view = createMemo(() => viewCache.load(scope(), params.id))

    const ensure = (file: string) => {
      if (!file) return
      if (store.file[file]) return
      setStore("file", file, { path: file, name: getFilename(file) })
    }

    const setLoading = (file: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )
    }

    const setLoaded = (file: string, content: FileState["content"]) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loaded = true
          draft.loading = false
          draft.content = content
        }),
      )
    }

    const setLoadError = (file: string, message: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = false
          draft.error = message
        }),
      )
      showToast({
        variant: "error",
        title: language.t("toast.file.loadFailed.title"),
        description: message,
      })
    }

    const load = (input: string, options?: { force?: boolean }) => {
      const file = path.normalize(input)
      if (!file) return Promise.resolve()

      const directory = scope()
      const key = `${directory}\n${file}`
      ensure(file)

      const current = store.file[file]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = inflight.get(key)
      if (pending) return pending

      setLoading(file)

      const promise = sdk.client.file
        .read({ path: file })
        .then((x) => {
          if (scope() !== directory) return
          const content = x.data
          setLoaded(file, content)

          if (!content) return
          touchFileContent(file, approxBytes(content))
          evictContent(new Set([file]))
        })
        .catch((e) => {
          if (scope() !== directory) return
          setLoadError(file, errorMessage(e, language.t("error.chain.unknown")))
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    }

    const search = (query: string, dirs: "true" | "false") =>
      sdk.client.find.files({ query, dirs }).then(
        (x) => (x.data ?? []).map(path.normalize),
        () => [],
      )

    const stop = sdk.event.listen((e) => {
      invalidateFromWatcher(e.details, {
        normalize: path.normalize,
        hasFile: (file) => Boolean(store.file[file]),
        isOpen: (file) => tabs.all().some((tab) => path.pathFromTab(tab) === file),
        loadFile: (file) => {
          void load(file, { force: true })
        },
        node: tree.node,
        isDirLoaded: tree.isLoaded,
        refreshDir: (dir) => {
          void tree.listDir(dir, { force: true })
        },
      })
    })

    const get = (input: string) => {
      const file = path.normalize(input)
      const state = store.file[file]
      const content = state?.content
      if (!content) return state
      if (hasFileContent(file)) {
        touchFileContent(file)
        return state
      }
      touchFileContent(file, approxBytes(content))
      return state
    }

    function withPath(input: string, action: (file: string) => unknown) {
      return action(path.normalize(input))
    }
    const scrollTop = (input: string) => withPath(input, (file) => view().scrollTop(file))
    const scrollLeft = (input: string) => withPath(input, (file) => view().scrollLeft(file))
    const selectedLines = (input: string) => withPath(input, (file) => view().selectedLines(file))
    const setScrollTop = (input: string, top: number) => withPath(input, (file) => view().setScrollTop(file, top))
    const setScrollLeft = (input: string, left: number) => withPath(input, (file) => view().setScrollLeft(file, left))
    const setSelectedLines = (input: string, range: SelectedLineRange | null) =>
      withPath(input, (file) => view().setSelectedLines(file, range))

    onCleanup(() => {
      stop()
      viewCache.clear()
    })

    const parentDir = (p: string) => {
      const idx = p.lastIndexOf("/")
      return idx === -1 ? "" : p.slice(0, idx)
    }

    const write = async (target: string, content: string, encoding?: "base64") => {
      const name = target.split("/").pop() || target
      tree.insertNode({ name, path: target, absolute: target, type: "file", ignored: false })
      await sdk.client.file.write({ path: target, content, encoding })
      const file = path.normalize(target)
      if (store.file[file]?.loaded)
        setLoaded(file, { type: encoding === "base64" ? "binary" : "text", content })
      void tree.listDir(parentDir(target), { force: true })
    }

    const mkdirOp = async (target: string) => {
      const name = target.split("/").pop() || target
      tree.insertNode({ name, path: target, absolute: target, type: "directory", ignored: false })
      await sdk.client.file.mkdir({ path: target })
      void tree.listDir(parentDir(target), { force: true })
    }

    const remove = async (target: string) => {
      await sdk.client.file.delete({ path: target })
      void tree.listDir(parentDir(target), { force: true })
    }

    const renameOp = async (old: string, next: string) => {
      await sdk.client.file.rename({ oldPath: old, newPath: next })
      void tree.listDir(parentDir(old), { force: true })
      const dst = parentDir(next)
      if (dst !== parentDir(old)) void tree.listDir(dst, { force: true })
    }

    const copyOp = async (src: string, dst: string) => {
      const result = await sdk.client.file.copy({ srcPath: src, dstPath: dst })
      const path = result.data?.path ?? dst
      void tree.listDir(parentDir(path), { force: true })
      return path
    }

    const upload = async (files: { path: string; content: string; encoding?: "base64" }[]) => {
      const dirs = new Set<string>()
      for (const f of files) {
        const dir = parentDir(f.path)
        if (dir && !dirs.has(dir)) {
          dirs.add(dir)
          await sdk.client.file.mkdir({ path: dir }).catch(() => {})
        }
        await sdk.client.file.write({ path: f.path, content: f.content, encoding: f.encoding })
      }
      void tree.listDir("", { force: true })
    }

    const downloadFile = async (target: string) => {
      const url = new URL(`${sdk.url.replace(/\/$/, "")}/file/download`)
      url.searchParams.set("path", target)
      url.searchParams.set("directory", sdk.directory)
      const resp = await fetch(url.toString())
      if (!resp.ok) throw new Error("Download failed")
      const blob = await resp.blob()
      const disposition = resp.headers.get("content-disposition")
      let filename = target.split("/").pop() || "download"
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/)
        if (match) filename = decodeURIComponent(match[1])
      }
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    }

    const serveUrl = (target: string) => {
      const url = new URL(`${sdk.url.replace(/\/$/, "")}/file/serve`)
      url.searchParams.set("path", target)
      url.searchParams.set("directory", sdk.directory)
      return url.toString()
    }

    const share = async (target: string): Promise<string> => {
      const url = new URL(`${sdk.url.replace(/\/$/, "")}/file/share`)
      url.searchParams.set("path", target)
      url.searchParams.set("directory", sdk.directory)
      const resp = await fetch(url.toString())
      if (!resp.ok) throw new Error("Share failed")
      const json = await resp.json() as { url: string }
      return json.url
    }

    return {
      ready: () => view().ready(),
      normalize: path.normalize,
      tab: path.tab,
      pathFromTab: path.pathFromTab,
      absolute: path.absolute,
      tree: {
        list: tree.listDir,
        refresh: (input: string) => tree.listDir(input, { force: true }),
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
        toggle(input: string) {
          if (tree.dirState(input)?.expanded) {
            tree.collapseDir(input)
            return
          }
          tree.expandDir(input)
        },
      },
      get,
      load,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      searchFiles: (query: string) => search(query, "false"),
      searchFilesAndDirectories: (query: string) => search(query, "true"),
      write,
      mkdir: mkdirOp,
      remove,
      rename: renameOp,
      upload,
      copy: copyOp,
      download: downloadFile,
      serveUrl,
      share,
    }
  },
})
