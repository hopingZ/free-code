import { randomUUID } from 'crypto'
import {
  getIsInteractive,
  getLlmRequestApprovalController,
} from '../bootstrap/state.js'

export type LlmRequestKind = 'messages' | 'token_count'

export type LlmRequestApprovalDecision = 'approve' | 'reject'

export type LlmRequestApprovalDialogRequest = {
  id: string
  querySource: string
  model: string
  kind: LlmRequestKind
  summary: string
  getFullContent: () => string
}

export type LlmRequestApprovalMetadata = {
  rawMessages?: readonly unknown[]
  rawSystemPrompt?: unknown
  userContext?: Record<string, string>
  systemContext?: Record<string, string>
  onReject?: () => void
  skipApproval?: boolean
  didReject?: boolean
}

export type LlmRequestApprovalInput = {
  querySource: string
  model: string
  kind?: LlmRequestKind
  messages: readonly unknown[]
  systemPrompt?: unknown
  tools?: readonly unknown[]
} & LlmRequestApprovalMetadata

let skipDepth = 0

export async function withSkippedLlmRequestApproval<T>(
  fn: () => Promise<T>,
): Promise<T> {
  skipDepth++
  try {
    return await fn()
  } finally {
    skipDepth--
  }
}

export async function approveLlmRequest(
  input: LlmRequestApprovalInput,
): Promise<boolean> {
  if (input.skipApproval || skipDepth > 0 || input.querySource === 'generate_session_title') {
    return true
  }

  const controller = getLlmRequestApprovalController()
  if (!controller || !getIsInteractive()) {
    return true
  }

  const decision = await controller(buildApprovalRequest(input))
  if (decision === 'reject') {
    input.didReject = true
    input.onReject?.()
    return false
  }

  return true
}

function buildApprovalRequest(
  input: LlmRequestApprovalInput,
): LlmRequestApprovalDialogRequest {
  const effectiveMessages = input.rawMessages ?? input.messages
  const summaryLines = [
    `即将发送 1 次${getKindLabel(input.kind ?? 'messages')}。`,
    `来源: ${input.querySource}`,
    `模型: ${input.model}`,
    `消息数: ${effectiveMessages.length}`,
    `工具数: ${input.tools?.length ?? 0}`,
    `system prompt 段数: ${countPromptSegments(input.systemPrompt)}`,
  ]

  const userContextKeys = Object.keys(input.userContext ?? {})
  if (userContextKeys.length > 0) {
    summaryLines.push(`用户 context 键: ${userContextKeys.join(', ')}`)
  }

  const systemContextKeys = Object.keys(input.systemContext ?? {})
  if (systemContextKeys.length > 0) {
    summaryLines.push(`系统 context 键: ${systemContextKeys.join(', ')}`)
  }

  const messagePreviewLines = summarizeMessages(effectiveMessages)
  if (messagePreviewLines.length > 0) {
    summaryLines.push('', '消息摘要:')
    summaryLines.push(...messagePreviewLines)
  }

  return {
    id: randomUUID(),
    querySource: input.querySource,
    model: input.model,
    kind: input.kind ?? 'messages',
    summary: summaryLines.join('\n'),
    getFullContent: () => buildFullContent(input),
  }
}

function buildFullContent(input: LlmRequestApprovalInput): string {
  const sections: string[] = []

  sections.push(
    buildSection('请求信息', [
      `类型: ${getKindLabel(input.kind ?? 'messages')}`,
      `来源: ${input.querySource}`,
      `模型: ${input.model}`,
      `消息数: ${(input.rawMessages ?? input.messages).length}`,
      `工具数: ${input.tools?.length ?? 0}`,
      `system prompt 段数: ${countPromptSegments(input.systemPrompt)}`,
    ]),
  )

  if (input.rawSystemPrompt !== undefined) {
    sections.push(
      buildSection('原始 system prompt', stringifyForDisplay(input.rawSystemPrompt)),
    )
  }

  if (input.userContext && Object.keys(input.userContext).length > 0) {
    sections.push(buildSection('用户 context', stringifyForDisplay(input.userContext)))
  }

  if (input.systemContext && Object.keys(input.systemContext).length > 0) {
    sections.push(buildSection('系统 context', stringifyForDisplay(input.systemContext)))
  }

  if (input.systemPrompt !== undefined) {
    sections.push(buildSection('最终 system prompt', stringifyForDisplay(input.systemPrompt)))
  }

  if (input.rawMessages !== undefined) {
    sections.push(buildSection('原始 messages', stringifyForDisplay(input.rawMessages)))
  }

  sections.push(buildSection('最终 messages', stringifyForDisplay(transformMessagesForDisplay(input.messages))))

  // if (input.tools && input.tools.length > 0) {
  //   sections.push(buildSection('tools', stringifyForDisplay(input.tools)))
  // }

  return sections.join('\n\n')
}

function buildSection(title: string, content: string | string[]): string {
  const body = Array.isArray(content) ? content.join('\n') : content
  return `=== ${title} ===\n${body || '无'}`
}

function getKindLabel(kind: LlmRequestKind): string {
  return kind === 'token_count' ? 'Token 估算请求' : 'LLM 请求'
}

function countPromptSegments(systemPrompt: unknown): number {
  if (typeof systemPrompt === 'string') {
    return systemPrompt.trim() ? 1 : 0
  }
  if (Array.isArray(systemPrompt)) {
    return systemPrompt.length
  }
  return systemPrompt ? 1 : 0
}

function summarizeMessages(messages: readonly unknown[]): string[] {
  return messages.slice(-3).map((message, index, recentMessages) => {
    const absoluteIndex = messages.length - recentMessages.length + index + 1
    const role = getMessageRole(message)
    const snippet = truncateForSummary(extractTextSnippet(message))
    return `${absoluteIndex}. ${role}: ${snippet || '[非文本内容]'}`
  })
}

function getMessageRole(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return 'unknown'
  }

  const record = message as Record<string, unknown>
  if (typeof record.role === 'string') {
    return record.role
  }
  if (typeof record.type === 'string') {
    return record.type
  }
  if (
    record.message &&
    typeof record.message === 'object' &&
    typeof (record.message as Record<string, unknown>).role === 'string'
  ) {
    return String((record.message as Record<string, unknown>).role)
  }
  return 'unknown'
}

function extractTextSnippet(value: unknown, depth: number = 0): string {
  if (depth > 4 || value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return normalizeWhitespace(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => extractTextSnippet(item, depth + 1)).find(Boolean) ?? ''
  }

  if (typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') {
    return normalizeWhitespace(record.text)
  }
  if (typeof record.content === 'string') {
    return normalizeWhitespace(record.content)
  }
  if (typeof record.thinking === 'string') {
    return normalizeWhitespace(record.thinking)
  }
  if (record.type === 'image') {
    return '[image]'
  }
  if (record.type === 'document') {
    return '[document]'
  }
  if (record.type === 'tool_use') {
    return `[tool_use:${String(record.name ?? 'unknown')}]`
  }
  if (record.type === 'tool_result') {
    const nested = extractTextSnippet(record.content, depth + 1)
    return nested ? `[tool_result] ${nested}` : '[tool_result]'
  }
  if (record.message !== undefined) {
    return extractTextSnippet(record.message, depth + 1)
  }
  if (record.content !== undefined) {
    return extractTextSnippet(record.content, depth + 1)
  }
  return ''
}

function truncateForSummary(text: string, maxLength: number = 140): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}…`
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function transformMessagesForDisplay(messages: readonly unknown[]): unknown[] {
  return messages.map(message => transformMessageContent(message))
}

function transformMessageContent(message: unknown): unknown {
  if (!message || typeof message !== 'object') {
    return message
  }

  const record = message as Record<string, unknown>

  // 递归处理嵌套的 message 字段（如 assistant 消息中的 message 属性）
  if (record.message !== undefined) {
    return {
      ...record,
      message: transformMessageContent(record.message),
    }
  }

  // 处理 content 数组
  if (Array.isArray(record.content)) {
    return {
      ...record,
      content: record.content.map(item => transformContentItem(item)),
    }
  }

  return message
}

function transformContentItem(item: unknown): unknown {
  if (!item || typeof item !== 'object') {
    return item
  }

  const record = item as Record<string, unknown>

  if (
    record.type === 'tool_result' &&
    typeof record.tool_use_id === 'string' &&
    record.tool_use_id.startsWith('call_function_') &&
    typeof record.content === 'string' &&
    record.content.startsWith('1\t')
  ) {
    return {
      ...record,
      content: '文件读取结果，参考上面 Read 工具调用详情',
    }
  }

  return item
}

function stringifyForDisplay(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
