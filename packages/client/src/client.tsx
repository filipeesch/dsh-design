/**
 * Browser half: a native session-scoped Design tab in the DSH right sidebar,
 * a session header action that opens it, and a titled same-origin preview frame
 * with a separate-tab link and a way back to the conversation.
 *
 * All integration goes through the published DSH client seams: the tab-type
 * registry, the two keyed tab seats, the header utilities list, and the
 * right-sidebar navigation controller. No DSH source or DOM is extended.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** Services this browser half needs before it activates. */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight']

/** Stable tab-type implementation identity (also the body/title seat key). */
export const DESIGN_TAB_ID = '@filipeesch/dsh-design-client/design-panel'
/** Tab type discriminator opened by the header action. */
export const DESIGN_TAB_KIND = 'design'

const MUTED = 'var(--dsw-alias-label-secondary, #475569)'
const BORDER = 'var(--dsw-alias-border-l2, #cbd5e1)'
const SURFACE = 'var(--dsw-alias-bg-layer-1, #ffffff)'
const TEXT = 'var(--dsw-alias-label-primary, #0f172a)'
const LINK = 'var(--dsw-alias-link, #1d4ed8)'
const ERROR = 'var(--dsw-alias-state-error-primary, #b91c1c)'

const LINK_STYLE: CSSProperties = {
  color: LINK,
  fontSize: 12,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}
const BUTTON_STYLE: CSSProperties = {
  border: '1px solid ' + BORDER,
  borderRadius: 7,
  background: 'transparent',
  color: TEXT,
  font: 'inherit',
  fontSize: 12,
  padding: '4px 8px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

/** Same-origin interactive preview URL for one session. */
export function previewUrl(sessionId: string): string {
  return '/design/' + encodeURIComponent(sessionId) + '/'
}

type PanelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly message: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Header utility action: opens or reveals the session's Design tab. */
export function DesignAction({ openDesign }: { readonly openDesign?: () => void }): ReactNode {
  return (
    <button type="button" aria-label="Design" title="Design" style={BUTTON_STYLE} onClick={() => openDesign?.()}>
      Design
    </button>
  )
}

/** Tab chip title. */
export function DesignTitle(): ReactNode {
  return <span>Design</span>
}

/** One session's Design tab body. */
export function DesignPanel(props: {
  readonly sessionId: string
  readonly sidebar?: {
    readonly forSession: (sessionId: string) => { readonly setExpanded: (expanded: boolean) => void }
  }
  readonly useTabInfo?: () => { readonly tab?: { readonly visible?: boolean } }
}): ReactNode {
  const { sessionId, sidebar } = props
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const visible = props.useTabInfo?.().tab?.visible ?? true
  const url = previewUrl(sessionId)
  const [state, setState] = useState<PanelState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setState({ kind: 'loading' })
    fetch(url, { method: 'HEAD', credentials: 'same-origin', signal: controller.signal }).then(
      (response) => {
        if (cancelled) return
        if (response.status === 404) setState({ kind: 'missing' })
        else if (!response.ok)
          setState({ kind: 'error', message: 'Preview request failed (' + String(response.status) + ').' })
        else setState({ kind: 'ready' })
      },
      (error: unknown) => {
        if (cancelled) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({ kind: 'error', message: 'Could not reach the design preview: ' + messageOf(error) })
      },
    )
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [url, reloadKey])

  useEffect(() => {
    if (!visible) return
    const frame = iframeRef.current
    frame?.contentWindow?.postMessage({ type: 'dsh-design-refresh' }, globalThis.location.origin)
  }, [visible, state.kind, reloadKey, url])

  const backToChat = useCallback(() => {
    try {
      sidebar?.forSession(sessionId).setExpanded(false)
    } catch {
      // A host without the per-session face refuses nothing here; the pane's
      // own close control remains available.
    }
  }, [sidebar, sessionId])

  const body =
    state.kind === 'ready' ? (
      <iframe
        key={url}
        ref={iframeRef}
        title={'Design preview for ' + sessionId}
        src={url}
        loading="eager"
        style={{ border: 0, display: 'block', width: '100%', height: '100%', background: '#ffffff' }}
        onLoad={() => {
          iframeRef.current?.contentWindow?.postMessage({ type: 'dsh-design-refresh' }, globalThis.location.origin)
        }}
      />
    ) : state.kind === 'missing' ? (
      <div role="status" style={{ padding: 16, color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ display: 'block', color: TEXT, marginBottom: 6 }}>No design project yet</strong>
        This session has no design files. Ask the agent to run <code>design_init</code>, then retry.
      </div>
    ) : state.kind === 'error' ? (
      <div role="alert" style={{ padding: 16, color: ERROR, fontSize: 13 }}>
        {state.message}
      </div>
    ) : (
      <div role="status" style={{ padding: 16, color: MUTED, fontSize: 13 }}>
        Loading design preview…
      </div>
    )

  return (
    <section
      aria-label="Design"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        color: TEXT,
        background: SURFACE,
        fontFamily: 'inherit',
      }}
    >
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid ' + BORDER,
          flex: '0 0 auto',
        }}
      >
        <strong style={{ fontSize: 13 }}>Design</strong>
        <a href={url} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
          Open in tab
        </a>
        <button
          type="button"
          style={{ ...BUTTON_STYLE, marginLeft: 'auto' }}
          onClick={backToChat}
          aria-label="Back to conversation"
        >
          Back to chat
        </button>
        {state.kind !== 'ready' ? (
          <button type="button" style={BUTTON_STYLE} onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </button>
        ) : null}
      </header>
      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>{body}</div>
    </section>
  )
}

/**
 * Client plugin body: register the tab type, its body and title, and the header
 * utility that opens it. Every registration is owned by an effect, so removing
 * the plugin removes all four contributions.
 */
export function apply(ctx: any): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.dshDesignClient = 'loaded'
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: DESIGN_TAB_ID,
        kind: DESIGN_TAB_KIND,
        priority: 'extension',
        keepMounted: true,
        title: () => 'Design',
      }),
    'design: tab type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: DESIGN_TAB_ID,
            inject: (sessionId: string) => ({ sessionId, sidebar: ctx.sidebarRight }),
          },
          DesignPanel,
        ),
      ),
    'design: panel body',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: DESIGN_TAB_ID }, DesignTitle),
      ),
    'design: panel title',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.session.header.utilities', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.utilities',
            id: 'design-panel',
            order: 200,
            label: 'Design',
            inject: () => ({ openDesign: () => ctx.sidebarRight.openTab(DESIGN_TAB_KIND) }),
          },
          DesignAction,
        ),
      ),
    'design: session action',
  )
}
