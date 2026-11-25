/**
 * Disposable harness for the standalone handoff review.
 *
 * Loaded through a DSH --patch overlay in a throwaway DSH_HOME. It creates
 * Design sessions without prompting a model, exercises the packed handoff tool,
 * reopens each package in a fresh workspace, and validates/journeys it with the
 * installed tools and real Chromium. No capture tool, synthetic app, or network
 * probe is part of this harness.
 */
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'design-handoff-review-session'

async function callTool(scope, agent, name, args) {
  const definition = scope.tools.definitions(agent).find((tool) => tool.name === name)
  if (definition === undefined) throw new Error('missing tool ' + name)
  return definition.execute(args, {
    agent,
    signal: new AbortController().signal,
    token: Symbol(name),
    name,
    arguments: args,
  })
}

async function filesBelow(root) {
  const result = new Map()
  const visit = async (directory, prefix = '') => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) await visit(join(directory, entry.name), path)
      else if (entry.isFile()) result.set(path, await readFile(join(directory, entry.name)))
    }
  }
  await visit(root)
  return result
}

function sameFiles(left, right) {
  if (left.size !== right.size) return false
  for (const [path, bytes] of left) {
    const other = right.get(path)
    if (other === undefined || !other.equals(bytes)) return false
  }
  return true
}

async function createSession(scope, workspaceId, sessionId, title, agentPreset) {
  const session = await scope.sessionController.create({
    sessionId,
    workspaceId,
    ...(agentPreset === undefined ? {} : { agentPreset }),
  })
  await scope.sessionController.rename({ sessionId: session.sessionId, title })
  const agent = scope.agents.get(session.sessionId)
  if (agent === undefined) throw new Error('no agent for ' + session.sessionId)
  return agent
}

function designTools(scope, agent) {
  return scope.tools
    .definitions(agent)
    .map((tool) => tool.name)
    .filter((name) => name.startsWith('design_'))
    .sort()
}

async function reopenAndValidate(scope, sourcePackage, root, sessionId, title) {
  await mkdir(root, { recursive: true })
  await cp(sourcePackage, join(root, 'design'), { recursive: true })
  const workspace = await scope.workspaceController.create({ path: root })
  await scope.workspaceController.rename({
    workspaceId: workspace.workspace.workspaceId,
    title: title + ' workspace',
  })
  const agent = await createSession(scope, workspace.workspace.workspaceId, sessionId, title, 'design')
  const validation = await callTool(scope, agent, 'design_validate', {})
  const manifest = JSON.parse(await readFile(join(root, 'design', 'manifest.json'), 'utf8'))
  const journeys = []
  for (const journey of manifest.journeys) {
    const run = await callTool(scope, agent, 'design_run_journey', { journey: journey.id })
    journeys.push({ id: journey.id, ok: run.ok === true, steps: run.steps?.length ?? 0 })
  }
  return {
    errors: validation.errors,
    warnings: validation.warnings,
    journeys,
    allJourneysPass: journeys.every((journey) => journey.ok),
  }
}

export function apply(ctx) {
  ctx.inject(['workspaceController', 'workspaceRegistry', 'sessionController', 'agents', 'tools'], (scope) => {
    const run = async () => {
      const cwd = process.env.REVIEW_CWD
      if (cwd === undefined || cwd === '') throw new Error('REVIEW_CWD is required')
      const design = join(cwd, 'design')

      const created = await scope.workspaceController.create({ path: cwd })
      const workspaceId = created.workspace.workspaceId
      await scope.workspaceController.rename({ workspaceId, title: 'Handoff review workspace' })
      const designAgent = await createSession(scope, workspaceId, 'handoff-review', 'Handoff Review', 'design')
      const standardAgent = await createSession(scope, workspaceId, 'handoff-standard', 'Handoff Standard')

      const designNames = designTools(scope, designAgent)
      const standardNames = designTools(scope, standardAgent)
      console.log('REVIEW_TOOLS', JSON.stringify({ design: designNames, standard: standardNames }))
      if (designNames.includes('design_capture') || standardNames.includes('design_capture')) {
        throw new Error('design_capture is registered in a preset')
      }
      if (!designNames.includes('design_handoff') || standardNames.includes('design_handoff')) {
        throw new Error('design_handoff registration is not Design-only')
      }

      const mobileSelection = { screens: ['checkout'], states: ['review-open'], breakpoints: ['mobile'] }
      const desktopSelection = { screens: ['checkout'], states: ['$default'], breakpoints: ['desktop'] }
      const mobile = await callTool(scope, designAgent, 'design_handoff', mobileSelection)
      if (mobile.status !== 'ok') throw new Error('mobile handoff failed: ' + mobile.error)
      const mobileManifest = JSON.parse(await readFile(join(cwd, mobile.package, 'manifest.json'), 'utf8'))
      const mobileFiles = await filesBelow(join(cwd, mobile.package))

      const reused = await callTool(scope, designAgent, 'design_handoff', mobileSelection)
      await rm(join(cwd, mobile.package), { recursive: true, force: true })
      const regenerated = await callTool(scope, designAgent, 'design_handoff', mobileSelection)
      const regeneratedFiles = await filesBelow(join(cwd, regenerated.package))

      const otherRoot = join(cwd, '..', 'handoff-other-workspace')
      await mkdir(otherRoot, { recursive: true })
      await cp(design, join(otherRoot, 'design'), { recursive: true })
      const other = await scope.workspaceController.create({ path: otherRoot })
      await scope.workspaceController.rename({
        workspaceId: other.workspace.workspaceId,
        title: 'Handoff other workspace',
      })
      const otherAgent = await createSession(
        scope,
        other.workspace.workspaceId,
        'handoff-other',
        'Handoff Other',
        'design',
      )
      const otherHandoff = await callTool(scope, otherAgent, 'design_handoff', mobileSelection)
      if (otherHandoff.status !== 'ok') throw new Error('other-workspace handoff failed: ' + otherHandoff.error)
      const otherFiles = await filesBelow(join(otherRoot, otherHandoff.package))

      const desktop = await callTool(scope, designAgent, 'design_handoff', desktopSelection)
      if (desktop.status !== 'ok') throw new Error('desktop handoff failed: ' + desktop.error)

      console.log(
        'REVIEW_HANDOFF',
        JSON.stringify({
          mobile: {
            id: mobile.id,
            projections: mobile.projections,
            screens: mobile.screens,
            supportingScreens: mobile.supportingScreens,
            breakpoints: mobile.breakpoints,
            files: mobileManifest.files.length,
            supportBreakpoints: mobileManifest.support.breakpoints,
            cacheRelative: mobile.package.includes('.cache/handoff'),
            noCapture: !JSON.stringify(mobileManifest).includes('design_capture'),
            noAbsolutePath: !JSON.stringify(mobileManifest).includes(cwd),
          },
          desktop: {
            id: desktop.id,
            projections: desktop.projections,
            breakpoints: desktop.breakpoints,
            distinctId: desktop.id !== mobile.id,
          },
        }),
      )
      console.log(
        'REVIEW_REPRODUCIBLE',
        JSON.stringify({
          reused: reused.reused === true && reused.id === mobile.id,
          sameId: regenerated.id === mobile.id,
          sameWorkspaceFiles: sameFiles(mobileFiles, regeneratedFiles),
          otherWorkspaceSameId: otherHandoff.id === mobile.id,
          otherWorkspaceSameFiles: sameFiles(mobileFiles, otherFiles),
          fileCount: mobileFiles.size,
        }),
      )

      const mobileReopen = await reopenAndValidate(
        scope,
        join(cwd, mobile.package),
        join(cwd, '..', 'reopen-mobile'),
        'reopen-mobile',
        'Reopen Mobile',
      )
      const desktopReopen = await reopenAndValidate(
        scope,
        join(cwd, desktop.package),
        join(cwd, '..', 'reopen-desktop'),
        'reopen-desktop',
        'Reopen Desktop',
      )
      console.log('REVIEW_REOPEN_MOBILE', JSON.stringify(mobileReopen))
      console.log('REVIEW_REOPEN_DESKTOP', JSON.stringify(desktopReopen))

      const gitignore = await readFile(join(design, '.gitignore'), 'utf8')
      console.log('REVIEW_CACHE_IGNORE', JSON.stringify({ cacheIgnored: gitignore.includes('.cache/') }))
      console.log('REVIEW_READY')
    }
    run().catch((error) => {
      console.error('REVIEW_ERROR', error instanceof Error ? error.stack : String(error))
    })
  })
}
