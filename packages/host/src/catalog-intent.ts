/** Local intent vocabulary; only names present in the current catalog can be returned. */
import type { CatalogSummary } from './catalog.ts'

const aliases: Readonly<Record<string, readonly string[]>> = {
  'shared-sidebar': [
    'shared layout',
    'shared sidebar',
    'side navigation',
    'sidebar navigation',
    'menu lateral',
    'barra lateral',
    'navegação lateral',
    'layout compartilhado',
    'layout partilhado',
    'reutilizar layout',
  ],
  'action-bar': [
    'action bar',
    'toolbar',
    'search bar',
    'growing input',
    'field next to button',
    'input beside action',
    'campo ao lado do botão',
    'barra de ações',
    'barra de ferramentas',
    'campo flexível',
    'repositório',
  ],
  'filter-drawer': [
    'filter drawer',
    'filter panel',
    'side sheet',
    'slide out panel',
    'drawer filters',
    'gaveta de filtros',
    'painel lateral',
    'filtros laterais',
    'painel de filtros',
  ],
  'fixture-table': [
    'fixture table',
    'mock table',
    'table with fictitious data',
    'sample data table',
    'table with fake data',
    'tabela com dados fictícios',
    'tabela com dados de exemplo',
    'dados simulados',
    'tabela',
    'fixture',
    'fixtures',
  ],
  'inline-feedback': [
    'inline feedback',
    'persistent alert',
    'warning with code',
    'aviso persistente',
    'mensagem em linha',
    'aviso com log',
  ],
  'view-controls': [
    'stateful controls',
    'display mode controls',
    'controles com estado',
    'controlos com estado',
    'preferências de visualização',
  ],
  'anchored-actions': ['anchored actions', 'anchored menu', 'alternate actions', 'menu ancorado', 'ações alternativas'],
  'responsive-layout': ['responsive layout', 'layout responsivo', 'empilhar no celular', 'empilhar no telemóvel'],
  'screen-navigation': ['navigate between screens', 'navegar entre telas', 'navegar entre ecrãs', 'trocar de página'],
  'named-disclosure': ['accordion', 'inline expandable content', 'acordeão', 'expandir conteúdo'],
  'preview-context': ['review situation', 'preview description', 'situação de revisão', 'contexto da prévia'],
  Layout: ['layout reutilizável', 'reusable template'],
  ContentSlot: ['content outlet', 'encaixe de conteúdo', 'slot de conteúdo'],
  styleClass: ['CSS class', 'local stylesheet', 'classes CSS', 'folha de estilos'],
  themes: [
    'theme',
    'dark mode',
    'light mode',
    'token palette',
    'tema escuro',
    'modo escuro',
    'modo claro',
    'paleta de cores',
    'temas',
  ],
  fixture: [
    'fixtures',
    'fictitious records',
    'sample records',
    'dados fictícios',
    'dados falsos',
    'registos fictícios',
    'registros fictícios',
  ],
  ItemTemplate: ['repeat list items', 'modelo de item', 'repetir itens'],
  states: ['named state', 'initial state', 'estado nomeado', 'estado inicial'],
  Journey: ['acceptance flow', 'interaction test', 'jornada', 'percurso', 'teste de interação'],
  Variants: ['visual alternatives', 'alternativas visuais', 'variantes'],
  Button: ['botão', 'botões'],
  Callout: ['inline notice', 'inline alert', 'feedback persistente', 'aviso em linha'],
  CodeBlock: ['code snippet', 'code block', 'literal log', 'bloco de código', 'trecho de código'],
  Disclosure: ['show more', 'show less', 'mostrar mais', 'mostrar menos'],
  Drawer: ['gaveta', 'lateral sheet', 'responsive drawer'],
  Input: ['text field', 'campo de texto', 'entrada de texto'],
  List: ['lista', 'listagem'],
  Modal: ['dialog', 'diálogo', 'janela modal'],
  Popover: ['anchored popover', 'popover ancorado', 'painel flutuante'],
  Select: ['dropdown', 'lista suspensa'],
  SelectButton: [
    'segmented control',
    'single choice buttons',
    'controle segmentado',
    'controlo segmentado',
    'botões segmentados',
  ],
  SplitButton: ['split button', 'button with menu', 'botão dividido', 'botão com menu'],
  Switch: ['visual switch', 'switch track', 'interruptor visual', 'interruptor'],
  Table: ['data table', 'tabela de dados', 'tabela'],
  Tabs: ['tabbed navigation', 'abas', 'separadores', 'guias'],
  Toast: ['transient notice', 'aviso temporário', 'notificação temporária'],
  ToggleButton: ['pressed button', 'toggle button', 'botão de alternância', 'botão pressionado'],
}

const stopWords = new Set(
  'a an and as at can could for from how i in is me of on or one please show that the to use want what which with you uma um uns umas e ou o os a as ao aos com como da das de do dos em na nas no nos para por que queria quero qual fazer usar mostrar'.split(
    ' ',
  ),
)
const MAX_MATCHES = 8

function normalized(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function terms(text: string): string[] {
  return text.split(' ').filter((word) => word !== '' && !stopWords.has(word))
}

type IntentSource = CatalogSummary & { readonly category?: string }

export function makeIntentSearch(entries: readonly IntentSource[]) {
  const indexed = entries.map(({ category, ...summary }) => {
    const literalName = normalized(summary.name)
    const name = normalized(summary.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
    const synonyms = Object.hasOwn(aliases, summary.name) ? (aliases[summary.name] ?? []) : []
    const phrases = synonyms.map((phrase) => terms(normalized(phrase)).join(' '))
    return {
      summary,
      name,
      literalName,
      canonicalTerms: new Set([...terms(name), ...terms(literalName)]),
      taggedTerms: new Set(terms(phrases.join(' '))),
      phrases,
      category,
    }
  })
  return (query: string): readonly CatalogSummary[] => {
    const text = normalized(query)
    if (text === '') return []
    const tokens = terms(text)
    const unique = new Set(tokens)
    const aligned = ' ' + tokens.join(' ') + ' '
    return indexed
      .map(({ name, literalName, canonicalTerms, taggedTerms, phrases, category, summary }) => {
        // Canonical names always rank first. Phrases favor a composition over isolated keyword matches;
        // common category tags only provide a weak fallback. Each distinct term counts once.
        if (text === name || text === literalName) return { summary, score: Number.MAX_SAFE_INTEGER }
        let score = 0
        for (const term of unique) {
          if (canonicalTerms.has(term)) score += 4
          else if (taggedTerms.has(term)) score += 3
          else if (category === term) score += 1
        }
        // Only the longest matching phrase contributes; overlapping aliases do not inflate relevance.
        const phraseScore = Math.max(
          0,
          ...phrases.map((phrase) =>
            phrase.includes(' ') && aligned.includes(' ' + phrase + ' ') ? phrase.split(' ').length * 3 : 0,
          ),
        )
        return { summary, score: score + phraseScore }
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => {
        if (left.score !== right.score) return right.score - left.score
        return left.summary.name < right.summary.name ? -1 : left.summary.name > right.summary.name ? 1 : 0
      })
      .slice(0, MAX_MATCHES)
      .map(({ summary }) => summary)
  }
}
