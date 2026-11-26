/** Optional DSH native image-result bridge. It never puts PNG bytes in tool values. */
interface ImageRef {
  readonly attachmentId: string
  readonly mediaType: 'image/png'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
  readonly originalDimensions?: { width: number; height: number }
}

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; attachment: ImageRef }

type ServiceContext = {
  get?(
    name: 'attachments',
  ): { saveImage?(input: { data: Buffer; mediaType: 'image/png' }): Promise<ImageRef> } | undefined
  get?(name: 'llm'):
    | {
        resolveModelInfo?(
          provider: string,
          model: string,
          signal?: AbortSignal,
        ): Promise<{ inputModalities?: readonly string[] }>
      }
    | undefined
}
interface Route {
  provider?: string
  model?: string
}
interface ImageExecution {
  readonly agent?: { readonly session?: { requestHeader?(): { config?: Route } | undefined }; readonly options?: Route }
  readonly signal?: AbortSignal
}

/** Persist a DSH attachment only when the active route declares image input. */
export async function screenshotAttachment(
  ctx: ServiceContext,
  exec: ImageExecution,
  data: Buffer,
): Promise<{ attachment: ImageRef; imageDelivery: 'inline' } | { imageDelivery: 'path-only'; imageFallback: string }> {
  const fallback = (imageFallback: string) => ({ imageDelivery: 'path-only' as const, imageFallback })
  try {
    const attachments = ctx.get?.('attachments')
    const llm = ctx.get?.('llm')
    if (!attachments?.saveImage || !llm?.resolveModelInfo) return fallback('The DSH image bridge is unavailable.')
    const routed = exec.agent?.session?.requestHeader?.()?.config
    const provider = routed?.provider ?? exec.agent?.options?.provider
    const model = routed?.model ?? exec.agent?.options?.model
    if (!provider || !model) return fallback('The active model route could not be verified.')
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    if (!info.inputModalities?.includes('image'))
      return fallback('The active model route does not declare image input.')
    if (exec.signal?.aborted) return fallback('Image delivery was cancelled.')
    const ref = await attachments.saveImage({ data, mediaType: 'image/png' })
    // Construct a JSON-safe reference to the durable object, not the storage implementation's entire return value.
    const attachment = {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...(ref.name === undefined ? {} : { name: ref.name }),
      ...(ref.originalDimensions === undefined
        ? {}
        : { originalDimensions: { width: ref.originalDimensions.width, height: ref.originalDimensions.height } }),
    }
    return { attachment, imageDelivery: 'inline' }
  } catch {
    return fallback('DSH could not attach this image on the current route.')
  }
}
