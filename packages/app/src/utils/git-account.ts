/** Derive the git/skill-sync account name from a workspace directory path. */
export function gitAccount(dir: string): string | null {
  if (dir.startsWith("/home/")) return dir.split("/")[2] || null
  if (dir.startsWith("/Users/leoliu/myroom")) return "xiaogenliu"
  return null
}
