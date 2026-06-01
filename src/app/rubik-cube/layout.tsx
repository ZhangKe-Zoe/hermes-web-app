import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '魔方速拧公式训练 | Hermes Web App',
  description: 'CFOP OLL PLL F2L 交互式学习系统，支持蓝牙连接智能魔方',
}

export default function RubikCubeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
