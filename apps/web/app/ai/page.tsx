import React from 'react';
import type { Metadata } from 'next';
import WebAiWorkspace from '@/components/ai/WebAiWorkspace';
import { constructMetadata } from '@/lib/seo';

export const metadata: Metadata = constructMetadata({
  title: 'MUXARO AI Studio — Autonomous Local & BYOK Assistant',
  description:
    'Run autonomous ReAct tool loops across 52 PDF and Media tools, execute isolated Python via Pyodide WASM, run local WebGPU models, or stream Gemini, OpenAI, and Claude.',
  path: '/ai',
});

export default function AiStudioPage() {
  return <WebAiWorkspace />;
}
