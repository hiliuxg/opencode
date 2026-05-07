export function sqlinfo(input: Record<string, unknown> = {}) {
  const engine = typeof input.engine === "string" && input.engine ? input.engine : ""
  const cluster = typeof input.cluster === "string" && input.cluster ? input.cluster : ""
  const base = engine && cluster ? `${engine} · ${cluster}` : engine || cluster
  const skill = typeof input.skill_name === "string" ? input.skill_name.trim() : ""
  if (!skill) return base
  if (!base) return skill
  return `${base} · ${skill}`
}

export function sqlerr(parsed: { message?: string; data?: { result_msg?: string } }, output: string) {
  return parsed.message || parsed.data?.result_msg || output
}
