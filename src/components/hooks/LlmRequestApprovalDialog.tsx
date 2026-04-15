import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type {
  LlmRequestApprovalDecision,
  LlmRequestApprovalDialogRequest,
} from '../../utils/llmRequestApproval.js'
import { Select } from '../CustomSelect/select.js'
import { PermissionDialog } from '../permissions/PermissionDialog.js'

type Props = {
  request: LlmRequestApprovalDialogRequest
  onDecision: (decision: LlmRequestApprovalDecision) => void
}

export function LlmRequestApprovalDialog({
  request,
  onDecision,
}: Props): React.ReactNode {
  const [expanded, setExpanded] = React.useState(false)

  const options = React.useMemo(
    () => [
      {
        label: '继续发送',
        value: 'approve',
        description: '允许这次请求继续发送',
      },
      {
        label: expanded ? '收起完整 context' : '展开完整 context',
        value: 'toggle',
        description: '查看完整 system prompt、context、messages',
      },
      {
        label: '取消发送',
        value: 'reject',
        description: '取消这次请求并返回上一状态',
      },
    ],
    [expanded],
  )

  const fullContent = React.useMemo(() => {
    if (!expanded) {
      return ''
    }
    return request.getFullContent()
  }, [expanded, request])

  return (
    <PermissionDialog
      title="发送前确认"
      subtitle={`来源: ${request.querySource} · 模型: ${request.model}`}
      titleRight={<Text dimColor>{request.kind === 'token_count' ? 'Token 估算' : 'LLM 请求'}</Text>}
    >
      <Box flexDirection="column">
        <Text>{request.summary}</Text>
        {expanded ? (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>{fullContent}</Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text dimColor>可先查看摘要，再展开完整 system prompt、context 和 messages。</Text>
          </Box>
        )}
        <Box flexDirection="column" paddingY={1}>
          <Select
            options={options}
            onChange={value => {
              if (value === 'toggle') {
                setExpanded(current => !current)
                return
              }
              onDecision(value as LlmRequestApprovalDecision)
            }}
          />
        </Box>
      </Box>
    </PermissionDialog>
  )
}
