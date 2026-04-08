export function assetPath(fileName: string): string {
  return `${import.meta.env.BASE_URL}${fileName}`
}
