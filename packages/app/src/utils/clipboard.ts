const text = (err: unknown) => (err instanceof Error ? err.message : String(err))

type Toast = (toast: { title: string; variant?: "error"; description?: string }) => void

export function copyPath(input: {
  path?: string
  labels: { success: string; fail: string }
  toast: Toast
  board?: Pick<Clipboard, "writeText"> | null
}) {
  const board = input.board === undefined ? (typeof navigator === "undefined" ? undefined : navigator.clipboard) : input.board
  if (!input.path || !board?.writeText) {
    input.toast({ variant: "error", title: input.labels.fail })
    return Promise.resolve(false)
  }

  return board.writeText(input.path).then(
    () => {
      input.toast({ title: input.labels.success })
      return true
    },
    (err: unknown) => {
      input.toast({
        variant: "error",
        title: input.labels.fail,
        description: text(err),
      })
      return false
    },
  )
}
